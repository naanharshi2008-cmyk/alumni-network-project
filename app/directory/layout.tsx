import type { Metadata } from 'next';

/**
 * A server layout over a client page, purely to say that every combination of
 * filters is the same page. Without it, ?cat=, ?batch=, ?q= and ?lens= would
 * fragment into dozens of near-identical indexed URLs competing with each
 * other - and with the profile pages, which are the ones worth finding.
 */
export const metadata: Metadata = {
  title: 'Alumni directory',
  description: 'Veveaham seniors — where they studied, how they got there, and what they are doing now.',
  alternates: { canonical: '/directory' },
};

export default function DirectoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
