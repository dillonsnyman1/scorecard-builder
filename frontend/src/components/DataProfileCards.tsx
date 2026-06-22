interface Props {
  totalEvents: number;
  totalNonEvents: number;
  eventRate: number;
  factorCount: number;
}

export function DataProfileCards({ totalEvents, totalNonEvents, eventRate, factorCount }: Props) {
  return (
    <div className="summary-cards">
      <div className="summary-card">
        <div className="summary-label">Factors Analysed</div>
        <div className="summary-value">{factorCount}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Event Rate</div>
        <div className="summary-value">{(eventRate * 100).toFixed(2)}%</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Events</div>
        <div className="summary-value">{totalEvents.toLocaleString()}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">Non-Events</div>
        <div className="summary-value">{totalNonEvents.toLocaleString()}</div>
      </div>
    </div>
  );
}
