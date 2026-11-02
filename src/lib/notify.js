import { toast } from '@/components/ui/use-toast';

export const notifySuccess = (title, description) =>
  toast({ title, description, duration: 1800 });

export const notifyError = (title, description) =>
  toast({ title, description, variant: 'destructive', duration: 3500 });