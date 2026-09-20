import { redirect } from 'next/navigation';

/** The dashboard opens on what needs attention. Old bookmarks land here. */
export default function AdminIndex() {
  redirect('/admin/today');
}
