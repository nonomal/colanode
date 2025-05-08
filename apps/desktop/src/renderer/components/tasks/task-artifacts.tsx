import {
  TaskArtifactOutput,
  formatBytes,
  formatMimeType,
} from '@colanode/core';
import { Download, Link } from 'lucide-react';

import { Button } from '@/renderer/components/ui/button';
import { FileIcon } from '@/renderer/components/files/file-icon';

interface TaskArtifactsProps {
  artifacts: TaskArtifactOutput[];
}

export const TaskArtifacts = ({ artifacts }: TaskArtifactsProps) => {
  const handleDownload = (artifact: TaskArtifactOutput) => {
    console.log('Download artifact:', artifact.name);
  };

  const handleCopyLink = (artifact: TaskArtifactOutput) => {
    console.log('Copy link:', artifact.name);
  };

  return (
    <div className="flex flex-col gap-2">
      {artifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="flex items-center gap-3 rounded-md border bg-card text-card-foreground shadow-sm p-3"
        >
          <FileIcon
            mimeType={artifact.mimeType}
            className="size-5 text-muted-foreground mr-1"
          />
          <div className="flex-grow">
            <div className="font-semibold text-base">{artifact.name}</div>
            <div className="text-xs text-muted-foreground">
              {formatMimeType(artifact.mimeType)} - {formatBytes(artifact.size)}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleDownload(artifact)}
              title="Download artifact"
            >
              <Download className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleCopyLink(artifact)}
              title="Copy download link"
            >
              <Link className="size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
