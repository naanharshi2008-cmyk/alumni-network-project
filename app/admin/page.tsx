import { redirect } from 'next/navigation';

/** The dashboard opens on what is waiting. Old /admin bookmarks land here. */
export default function AdminIndex() {
  redirect('/admin/review');
}
