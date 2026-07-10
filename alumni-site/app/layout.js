import './globals.css';

export const metadata = {
  title: 'Alumni Site',
  description: 'Know where your seniors are and what they are doing',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
