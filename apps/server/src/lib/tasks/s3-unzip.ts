import {
  AbortMultipartUploadCommand,
  CompletedPart,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createDebugger } from '@colanode/core';
import PLimit, { LimitFunction } from 'p-limit';
import unzipper from 'unzipper';

import { Readable } from 'stream';

interface S3UnzipOptions {
  s3: S3Client;
  bucket: string;
  inputKey: string;
  outputPrefix: string;
  maxPartSize?: number;
  maxParallelFiles?: number;
}

const DEFAULT_MAX_PART_SIZE = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_MAX_PARALLEL_FILES = 3;
const debug = createDebugger('s3-unzip');

export class S3Unzip {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly inputKey: string;
  private readonly outputPrefix: string;
  private readonly maxPartSize: number;
  private readonly filesLimit: LimitFunction;
  private readonly entries: S3UnzipEntry[] = [];
  private readonly outputKeys: string[] = [];
  private extractedBytes = 0;

  constructor(options: S3UnzipOptions) {
    this.s3 = options.s3;
    this.bucket = options.bucket;
    this.inputKey = options.inputKey;
    this.outputPrefix = options.outputPrefix.replace(/^\//, ''); // no leading “/”
    this.maxPartSize = options.maxPartSize ?? DEFAULT_MAX_PART_SIZE;
    this.filesLimit = PLimit(
      options.maxParallelFiles ?? DEFAULT_MAX_PARALLEL_FILES
    );
  }

  public async unzip() {
    try {
      const zipStream = await this.fetchZip();
      const parser = zipStream.pipe(unzipper.Parse({ forceStream: true }));
      const allUploads: Promise<void>[] = [];

      for await (const entry of parser) {
        if (entry.type !== 'File') {
          entry.autodrain();
          continue;
        }

        const outputKey = `${this.outputPrefix}/${entry.path}`;
        const s3UnzipEntry = new S3UnzipEntry({
          s3: this.s3,
          bucket: this.bucket,
          outputKey,
          maxPartSize: this.maxPartSize,
          entry,
        });

        this.entries.push(s3UnzipEntry);

        const uploadPromise = this.filesLimit(async () => {
          const { bytes } = await s3UnzipEntry.upload();
          this.extractedBytes += bytes;
          this.outputKeys.push(outputKey);
        });

        allUploads.push(uploadPromise);
      }

      await Promise.all(allUploads);

      debug(
        `Finished unzipping "${this.inputKey}" (${this.outputKeys.length} files, ${this.extractedBytes} bytes)`
      );

      return {
        outputKeys: this.outputKeys,
        extractedBytes: this.extractedBytes,
      };
    } catch (err) {
      await this.cancel(err as Error);
      throw err;
    }
  }

  private async fetchZip() {
    const { Body } = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.inputKey,
      })
    );

    if (!Body || !(Body instanceof Readable)) {
      throw new Error('Could not obtain a stream for the zip file');
    }

    return Body;
  }

  private async cancel(error: Error) {
    debug(`Cancelling due to error: ${error.message}`);

    await Promise.all(
      this.entries.map(async (entry) => {
        try {
          await entry.cancel();
        } catch (abortErr) {
          debug('Failed to abort unzip entry', abortErr);
        }
      })
    );
  }
}

interface S3UnzipEntryOptions {
  s3: S3Client;
  bucket: string;
  entry: unzipper.Entry;
  outputKey: string;
  maxPartSize?: number;
}

class S3UnzipEntry {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly outputKey: string;
  private readonly maxPartSize: number;
  private readonly entry: unzipper.Entry;

  private totalBytes = 0;
  private buffer = Buffer.alloc(0);
  private uploadId: string | undefined;
  private completedParts: CompletedPart[] = [];
  private partNumber = 1;

  constructor(options: S3UnzipEntryOptions) {
    this.s3 = options.s3;
    this.bucket = options.bucket;
    this.outputKey = options.outputKey;
    this.maxPartSize = options.maxPartSize ?? DEFAULT_MAX_PART_SIZE;
    this.entry = options.entry;
  }

  public async upload() {
    try {
      for await (const chunk of this.entry) {
        this.totalBytes += chunk.length;
        this.buffer = Buffer.concat([this.buffer, chunk]);

        if (this.buffer.length >= this.maxPartSize) {
          if (!this.uploadId) {
            await this.createMultipartUpload();
          }

          await this.uploadPart();
        }
      }

      if (this.buffer.length) {
        if (this.uploadId) {
          await this.uploadPart();
        } else {
          await this.putObject();
        }
      }

      if (this.uploadId) {
        await this.completeMultipartUpload();
      }

      return { bytes: this.totalBytes };
    } catch (err) {
      await this.cancel();
      throw err;
    }
  }

  private async createMultipartUpload() {
    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.outputKey,
      })
    );

    if (!UploadId) {
      throw new Error('Could not create multipart upload');
    }

    this.uploadId = UploadId;
  }

  private async completeMultipartUpload() {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: this.outputKey,
        UploadId: this.uploadId,
        MultipartUpload: { Parts: this.completedParts },
      })
    );
  }

  private async uploadPart() {
    const partBuffer = this.buffer;
    this.buffer = Buffer.alloc(0);

    const { ETag } = await this.s3.send(
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: this.outputKey,
        UploadId: this.uploadId,
        PartNumber: this.partNumber,
        Body: partBuffer,
      })
    );

    if (!ETag) {
      throw new Error('Failed to upload part');
    }

    this.completedParts.push({ PartNumber: this.partNumber, ETag });
    this.partNumber += 1;
  }

  private async putObject() {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.outputKey,
        Body: this.buffer,
      })
    );
  }

  public async cancel() {
    if (this.uploadId) {
      await this.s3.send(
        new AbortMultipartUploadCommand({
          Bucket: this.bucket,
          Key: this.outputKey,
          UploadId: this.uploadId,
        })
      );
    }
  }
}
