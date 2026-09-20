import { permanentRedirect } from 'next/navigation';

/** There is no index of people here; the directory is that. */
export default function AlumniIndex() {
  permanentRedirect('/directory');
}
