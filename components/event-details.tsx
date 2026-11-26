import { CalendarDays, Gift, MapPin } from "lucide-react";
import { DateSecret } from "./easter-eggs";

const event = {
  date: "2026-12-14",
  dateLabel: "14 December 2026",
  location: "Conf 5D006, Floor 5",
  building: "Krishna Magnum",
};

export function EventDetails({ compact = false }: { compact?: boolean }) {
  if (compact) return <div className="event-summary" aria-label="Event date and location">
    <p className="event-summary-date"><DateSecret date={event.date} label={event.dateLabel} withIcon /></p>
    <p className="event-summary-venue"><MapPin size={20} aria-hidden="true" /><span><strong>{event.building}</strong><span className="event-summary-room">{event.location}</span></span></p>
  </div>;
  return <section className="panel event-details" aria-labelledby="event-details-title">
    <h2 id="event-details-title">Event details</h2>
    <dl className="event-details-grid">
      <div>
        <dt><CalendarDays size={17} aria-hidden="true" />Date</dt>
        <dd><DateSecret date={event.date} label={event.dateLabel} /></dd>
      </div>
      <div>
        <dt><Gift size={17} aria-hidden="true" />Gift budget</dt>
        <dd>Around ₹800 <span className="event-currency">(INR)</span></dd>
      </div>
      <div>
        <dt><MapPin size={17} aria-hidden="true" />Location</dt>
        <dd>{event.location}<span className="event-building">{event.building}</span></dd>
      </div>
    </dl>
  </section>;
}
