import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/renderer/components/ui/dialog';
import { Button } from '@/renderer/components/ui/button';
import { Spinner } from '@/renderer/components/ui/spinner';
import { useMutation } from '@/renderer/hooks/use-mutation';
import { useWorkspace } from '@/renderer/contexts/workspace';
import { toast } from '@/renderer/hooks/use-toast';
import { useLayout } from '@/renderer/contexts/layout';

interface TaskCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const TaskCreateDialog = ({
  open,
  onOpenChange,
}: TaskCreateDialogProps) => {
  const workspace = useWorkspace();
  const layout = useLayout();
  const { mutate, isPending } = useMutation();

  const handleTaskCreate = () => {
    mutate({
      input: {
        type: 'task_create',
        accountId: workspace.accountId,
        workspaceId: workspace.id,
        name: 'Export workspace',
        description:
          'Export all data from this workspace into one or more files.',
        attributes: {
          type: 'export_workspace',
          workspaceId: workspace.id,
        },
      },
      onSuccess: (data) => {
        layout.previewLeft(data.task.id);
        onOpenChange(false);
      },
      onError: () => {
        toast({
          title: 'Error',
          description:
            'An error occurred while creating the task. Please try again later.',
        });
      },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create task</DialogTitle>
          <DialogClose />
        </DialogHeader>
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Export all data from this workspace into one or more files. The
            exported files are in zip format and can be used to import this
            workspace into another Colanode server.
          </p>
          <p>
            This operation can take a while to complete, depending on the size
            of the workspace. The export will be performed in the background and
            you can track the progress inside the Colanode desktop app.
          </p>
          <p>
            Once the export is complete you will have access to the files to
            download them.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={handleTaskCreate} disabled={isPending}>
            {isPending && <Spinner className="mr-1" />}
            Create task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
