// The one signature visual flourish: a hand-placed constellation, rendered as
// thin gold lines connecting star points, evoking a celestial chart / star atlas
// rather than a generic particle background.

const STARS = [
  [40, 60], [120, 40], [210, 90], [300, 50], [380, 110],
  [90, 160], [190, 190], [270, 170], [350, 210], [60, 250],
  [150, 280], [250, 300], [330, 270], [400, 240], [20, 200],
]

const LINES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [12, 13], [6, 11], [0, 14], [14, 9],
]

export default function ConstellationField() {
  return (
    <div className="constellation-field" aria-hidden="true">
      <svg viewBox="0 0 420 320" preserveAspectRatio="xMidYMid slice">
        {LINES.map(([a, b], i) => (
          <line
            key={i}
            x1={STARS[a][0]}
            y1={STARS[a][1]}
            x2={STARS[b][0]}
            y2={STARS[b][1]}
            stroke="#7a672f"
            strokeWidth="0.6"
          />
        ))}
        {STARS.map(([x, y], i) => (
          <circle key={i} className="star" cx={x} cy={y} r={i % 4 === 0 ? 2.1 : 1.3} fill="#e8c766" />
        ))}
      </svg>
    </div>
  )
}
