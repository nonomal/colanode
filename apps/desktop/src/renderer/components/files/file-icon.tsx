import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileJson,
  FileText,
  FileVideo,
} from 'lucide-react';

interface FileIconProps {
  mimeType: string;
  className?: string;
}

export const FileIcon = ({ mimeType, className }: FileIconProps) => {
  if (mimeType === 'application/json') {
    return <FileJson className={className} />;
  }

  if (mimeType === 'application/zip') {
    return <FileArchive className={className} />;
  }

  if (mimeType.startsWith('image')) {
    return <FileImage className={className} />;
  }

  if (mimeType.startsWith('video')) {
    return <FileVideo className={className} />;
  }

  if (mimeType.startsWith('audio')) {
    return <FileAudio className={className} />;
  }

  if (mimeType.startsWith('text')) {
    return <FileText className={className} />;
  }

  return <File className={className} />;
};
