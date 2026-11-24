import { menuOwnsKeyboard } from '@/ui/menu/menuStore';
import { isAsking } from '@/ui/widgets/askDialog';

export function keyboardBlocked(): boolean {
  return menuOwnsKeyboard() || isAsking();
}
