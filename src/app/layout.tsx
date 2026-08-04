export const metadata = {
  title: 'Indie',
  description: 'A full-stack music platform for independent artists and listeners',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
