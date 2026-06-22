import { useState } from "react";

interface Props {
  matrix: number[][];
  factorNames: string[];
}

function correlationColor(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.05) return "#f8fafc";
  if (value > 0) {
    const t = Math.min(abs, 1);
    const r = Math.round(239 - t * 202);
    const g = Math.round(246 - t * 162);
    const b = Math.round(255 - t * 24);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = Math.min(abs, 1);
    const r = Math.round(239 + t * 16);
    const g = Math.round(246 - t * 118);
    const b = Math.round(255 - t * 127);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

function textColor(value: number): string {
  return Math.abs(value) > 0.6 ? "#fff" : "#334155";
}

export function CorrelationHeatmap({ matrix, factorNames }: Props) {
  const [hoveredCell, setHoveredCell] = useState<[number, number] | null>(null);

  if (factorNames.length === 0) return null;

  const n = factorNames.length;
  const cellSize = n > 25 ? 28 : n > 15 ? 34 : 40;
  const showValues = n <= 20;
  const labelWidth = 150;

  return (
    <details className="collapsible-section">
      <summary>Spearman Correlation Matrix ({n} factors)</summary>
      <div className="heatmap-container">
        {hoveredCell && (
          <div className="heatmap-tooltip">
            <strong>{factorNames[hoveredCell[0]]}</strong> vs <strong>{factorNames[hoveredCell[1]]}</strong>: {matrix[hoveredCell[0]][hoveredCell[1]].toFixed(3)}
          </div>
        )}
        <div className="heatmap-scroll">
          <svg
            width={labelWidth + n * cellSize + 2}
            height={n * cellSize + 2}
            className="heatmap-svg"
          >
            {factorNames.map((name, i) => (
              <text
                key={`row-${i}`}
                x={labelWidth - 8}
                y={i * cellSize + cellSize / 2 + 4}
                textAnchor="end"
                className="heatmap-label"
              >
                {name.length > 22 ? name.slice(0, 21) + "..." : name}
              </text>
            ))}

            {factorNames.map((_, i) =>
              factorNames.map((_, j) => {
                const val = matrix[i][j];
                const x = labelWidth + j * cellSize;
                const y = i * cellSize;
                const isHovered =
                  hoveredCell && (hoveredCell[0] === i || hoveredCell[1] === j);
                return (
                  <g
                    key={`${i}-${j}`}
                    onMouseEnter={() => setHoveredCell([i, j])}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    <rect
                      x={x}
                      y={y}
                      width={cellSize}
                      height={cellSize}
                      fill={correlationColor(val)}
                      stroke={isHovered ? "#1e40af" : "#fff"}
                      strokeWidth={isHovered ? 1.5 : 0.5}
                      rx={2}
                    />
                    {showValues && (
                      <text
                        x={x + cellSize / 2}
                        y={y + cellSize / 2 + 4}
                        textAnchor="middle"
                        fill={textColor(val)}
                        className="heatmap-value"
                      >
                        {val.toFixed(2)}
                      </text>
                    )}
                  </g>
                );
              }),
            )}
          </svg>
        </div>

        <div className="heatmap-legend">
          <span>-1.0</span>
          <div className="heatmap-legend-bar" />
          <span>0</span>
          <div className="heatmap-legend-bar positive" />
          <span>+1.0</span>
        </div>
      </div>
    </details>
  );
}
