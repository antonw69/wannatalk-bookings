export function notFound(req, res) {
  res.status(404).json({ error: 'Route not found' });
}

export function errorHandler(error, req, res, next) {
  console.error(error);
  const status = error.statusCode || 500;
  res.status(status).json({ error: status === 500 ? 'Server error' : error.message });
}
