import { createContext, useContext } from 'react';

interface LayoutContextProps {
  preview: (tab: string, keepCurrent?: boolean) => void;
  previewLeft: (tab: string, keepCurrent?: boolean) => void;
  previewRight: (tab: string, keepCurrent?: boolean) => void;
  open: (tab: string) => void;
  openLeft: (tab: string) => void;
  openRight: (tab: string) => void;
  close: (tab: string) => void;
  closeLeft: (tab: string) => void;
  closeRight: (tab: string) => void;
  activeTab?: string;
}

export const LayoutContext = createContext<LayoutContextProps>(
  {} as LayoutContextProps
);

export const useLayout = () => useContext(LayoutContext);
