export default function apiNotFoundHandler(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({
    ok: false,
    error: { code: 'api_route_not_found', message: 'API route not found.' },
  });
}
