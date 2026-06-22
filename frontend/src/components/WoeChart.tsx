import {
  Bar,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BinDetail } from "../types/analysis";

interface Props {
  bins: BinDetail[];
  compact?: boolean;
}

export function WoeChart({ bins, compact = false }: Props) {
  const data = bins.map((b) => ({
    name: b.bin_label,
    woe: b.woe,
    event_rate: b.event_rate,
    count: b.count,
    is_special: b.is_special,
  }));

  const height = compact ? 200 : 300;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11 }}
          angle={-30}
          textAnchor="end"
          height={60}
        />
        <YAxis yAxisId="woe" tick={{ fontSize: 11 }} />
        <YAxis
          yAxisId="rate"
          orientation="right"
          tick={{ fontSize: 11 }}
          tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
        />
        <Tooltip
          formatter={(value, name) => {
            const v = Number(value);
            return name === "Event Rate" ? `${(v * 100).toFixed(2)}%` : v.toFixed(4);
          }}
        />
        <Bar yAxisId="woe" dataKey="woe" name="WoE" radius={[3, 3, 0, 0]}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={d.is_special ? "#94a3b8" : d.woe >= 0 ? "var(--accent)" : "var(--negative)"}
              strokeDasharray={d.is_special ? "4 2" : undefined}
              stroke={d.is_special ? "#64748b" : undefined}
            />
          ))}
        </Bar>
        <Line
          yAxisId="rate"
          type="monotone"
          dataKey="event_rate"
          name="Event Rate"
          stroke="#f59e0b"
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
