import {
  AbortMultipartUploadCommand,
  CompletedPart,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createDebugger } from '@colanode/core';
import archiver from 'archiver';
import PLimit, { LimitFunction } from 'p-limit';

import path from 'path';
import { PassThrough, Readable } from 'stream';

interface S3ArchiverOptions {
  s3: S3Client;
  bucket: string;
  inputKeys: string[];
  outputKey: string;
  maxPartSize?: number;
  maxParallelFiles?: number;
}

interface FilePromise {
  fileName: string;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

const DEFAULT_MAX_PART_SIZE = 10 * 1024 * 1024; //10MB
const DEFAULT_MAX_PARALLEL_FILES = 3;
const debug = createDebugger('s3-zipper');

export class S3Zip {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly inputKeys: string[];
  private readonly outputKey: string;
  private readonly maxPartSize: number;
  private readonly filesLimit: LimitFunction;

  private readonly archiver: archiver.Archiver;
  private readonly passThrough: PassThrough;
  private readonly filePromises: Map<string, FilePromise>;

  private uploadId: string | undefined;
  private partNumber = 1;
  private readonly completedParts: CompletedPart[] = [];

  private readonly zipFileName: string;
  private zipFileSize = 0;

  constructor(options: S3ArchiverOptions) {
    this.s3 = options.s3;
    this.bucket = options.bucket;
    this.inputKeys = options.inputKeys;
    this.outputKey = options.outputKey;
    this.maxPartSize = options.maxPartSize ?? DEFAULT_MAX_PART_SIZE;
    this.filesLimit = PLimit(
      options.maxParallelFiles ?? DEFAULT_MAX_PARALLEL_FILES
    );

    this.zipFileName = path.basename(this.outputKey);

    this.archiver = archiver('zip', { zlib: { level: 9 } });
    this.passThrough = new PassThrough();
    this.filePromises = new Map<string, FilePromise>();
    this.archiver.pipe(this.passThrough);

    this.archiver.on('entry', (entry) => {
      debug(`Entry ${entry.name} added to archive`);

      const fileName = entry.name;
      const filePromise = this.filePromises.get(fileName);
      if (!filePromise) {
        debug(`File promise not found for ${fileName}`);
        return;
      }

      filePromise.resolve();
    });

    this.archiver.on('error', (error) => {
      debug(`Archiver error: ${error}`);
      this.cancel(error);
    });

    this.passThrough.on('data', (chunk) => {
      this.zipFileSize += chunk.length;
    });

    this.passThrough.on('error', (error) => {
      debug(`Pass through error: ${error}`);
      this.cancel(error);
    });
  }

  public async zip() {
    try {
      await this.createMultipartUpload();

      const uploadPromise = this.uploadParts();

      await this.downloadFiles();
      await this.archiver.finalize();

      await uploadPromise;

      await this.completeMultipartUpload();

      this.passThrough.end();

      return {
        zipFileSize: this.zipFileSize,
        zipFileName: this.zipFileName,
      };
    } catch (error) {
      await this.cancel(error as Error);
      throw error;
    }
  }

  private async cancel(error: Error) {
    if (this.uploadId) {
      await this.s3.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: this.outputKey,
          UploadId: this.uploadId,
        })
      );
    }

    for (const filePromise of this.filePromises.values()) {
      filePromise.reject(error);
    }
  }

  private async downloadFiles() {
    for (const inputKey of this.inputKeys) {
      await this.downloadFile(inputKey);
    }
  }

  private async downloadFile(inputKey: string) {
    debug(`Downloading file ${inputKey}`);

    const fileName = path.basename(inputKey);

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: inputKey,
      });

      const response = await this.s3.send(command);
      if (!response.Body) {
        return;
      }

      this.archiver.append(response.Body as Readable, { name: fileName });

      const filePromise = this.createFilePromise(fileName);
      this.filePromises.set(fileName, filePromise);

      await this.filesLimit(() => filePromise.promise);
    } catch (error) {
      this.filePromises.delete(fileName);
      throw error;
    }
  }

  private async createMultipartUpload() {
    debug(`Creating multipart upload for ${this.outputKey}`);

    const command = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: this.outputKey,
    });

    const response = await this.s3.send(command);
    if (!response.UploadId) {
      throw new Error('Failed to create multipart upload');
    }

    this.uploadId = response.UploadId;
  }

  private async completeMultipartUpload() {
    debug(`Completing multipart upload for ${this.outputKey}`);

    const command = new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: this.outputKey,
      UploadId: this.uploadId,
      MultipartUpload: {
        Parts: this.completedParts,
      },
    });

    await this.s3.send(command);
  }

  private async uploadParts() {
    let buffer = Buffer.alloc(0);
    for await (const chunk of this.passThrough) {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length >= this.maxPartSize) {
        await this.uploadPart(buffer);
        buffer = Buffer.alloc(0);
      }
    }

    if (buffer.length > 0) {
      await this.uploadPart(buffer);
    }
  }

  private async uploadPart(buffer: Buffer) {
    if (!this.uploadId) {
      throw new Error('No upload ID');
    }

    debug(`Uploading part ${this.partNumber} for ${this.outputKey}`);

    const partNumber = this.partNumber++;
    const command = new UploadPartCommand({
      Bucket: this.bucket,
      Key: this.outputKey,
      UploadId: this.uploadId,
      PartNumber: partNumber,
      Body: buffer,
    });

    const response = await this.s3.send(command);
    if (!response.ETag) {
      throw new Error('Failed to upload part');
    }

    this.completedParts.push({
      PartNumber: partNumber,
      ETag: response.ETag,
    });
  }

  private createFilePromise(fileName: string): FilePromise {
    let resolvePromise: () => void;
    let rejectPromise: (error: Error) => void;

    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const filePromise: FilePromise = {
      fileName,
      promise,
      resolve: resolvePromise!,
      reject: rejectPromise!,
    };

    return filePromise;
  }
}
