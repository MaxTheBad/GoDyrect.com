export const metadata = {
  title: 'GoDyrect',
  description: 'Buy and sell businesses',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Inter, Arial, sans-serif', background: '#0b1020', color: '#fff' }}>
        {children}
      </body>
    </html>
  );
}
