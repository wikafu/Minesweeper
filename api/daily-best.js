export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    method: req.method,
    message: 'Minesweeper daily-best API is alive 🎉',
  });
}
