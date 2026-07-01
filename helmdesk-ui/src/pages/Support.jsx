import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Icon, SectionHeader } from '../components/ui.jsx';

/**
 * Support tab: a contact form (emailed to our inbox) plus an optional paid onboarding call
 * ($2 / 30 min). The paid block only renders when the backend reports it's configured
 * (a billing meter + calendar link are set); otherwise just the contact form shows.
 */
export default function Support({ notify }) {
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({ subject: '', message: '' });
  const [sending, setSending] = useState(false);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(null); // { schedulingUrl } after a successful charge

  useEffect(() => {
    api.supportConfig().then((r) => setCfg(r)).catch(() => setCfg({ onboarding: { available: false } }));
  }, []);

  const sendContact = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) { notify('Add a subject and a message.', true); return; }
    setSending(true);
    try {
      const r = await api.supportContact(form);
      notify(r.message || 'Message sent.');
      setForm({ subject: '', message: '' });
    } catch (err) {
      notify(err.message, true);
    } finally {
      setSending(false);
    }
  };

  const book = async () => {
    setBooking(true);
    try {
      const r = await api.bookOnboardingCall();
      setBooked({ schedulingUrl: r.schedulingUrl });
      notify(r.message || 'Charged. Pick a time.');
    } catch (err) {
      notify(err.message, true);
    } finally {
      setBooking(false);
    }
  };

  const price = cfg?.onboarding?.priceUsd ?? 2;
  const mins = cfg?.onboarding?.durationMins ?? 30;
  const paidAvailable = cfg?.onboarding?.available;

  return (
    <>
      <div className="topbar">
        <h1>Support</h1>
        <span className="sub">Reach our team or book a guided onboarding call.</span>
      </div>

      <div className="page support-grid">
        {/* Contact form */}
        <div className="card">
          <SectionHeader icon="send" title="Message our team"
            description="Questions, bugs, or feature requests. We reply by email — usually within one business day." />
          <form onSubmit={sendContact} style={{ marginTop: 16 }}>
            <div className="field">
              <label>Subject</label>
              <input type="text" value={form.subject} maxLength={140}
                placeholder="e.g. How do I route tickets to a specific agent?"
                onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
            </div>
            <div className="field">
              <label>Message</label>
              <textarea rows={6} value={form.message}
                placeholder="Tell us what's going on…"
                onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </div>
            <button className="btn btn-accent" type="submit" disabled={sending}>
              <Icon name="send" size={15} /> {sending ? 'Sending…' : 'Send message'}
            </button>
          </form>
        </div>

        {/* Onboarding call */}
        <div className="card">
          <SectionHeader icon="clock" title="Onboarding call"
            description={`A ${mins}-minute screen-share with our team to get your helpdesk set up right.`} />

          {!paidAvailable ? (
            <div className="support-note" style={{ marginTop: 16 }}>
              Guided calls aren’t available yet. Send a message on the left and we’ll arrange a time.
            </div>
          ) : booked ? (
            <div style={{ marginTop: 16 }}>
              <div className="support-paid-ok">
                <Icon name="check" size={16} /> Payment received — pick a time that works for you.
              </div>
              <a className="btn btn-accent" href={booked.schedulingUrl} target="_blank" rel="noreferrer"
                style={{ marginTop: 14 }}>
                <Icon name="clock" size={15} /> Choose your time slot
              </a>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <div className="support-price">
                <span className="amt">${price.toFixed(2)}</span>
                <span className="per">/ {mins}-min session</span>
              </div>
              <ul className="support-perks">
                <li><Icon name="check" size={14} /> Live walkthrough of channels, routing & SLAs</li>
                <li><Icon name="check" size={14} /> We tailor the setup to your workflow</li>
                <li><Icon name="check" size={14} /> Bring your questions — screen-shared, one-on-one</li>
              </ul>
              <button className="btn btn-accent" onClick={book} disabled={booking}>
                {booking ? 'Processing…' : `Book call — $${price.toFixed(2)}`}
              </button>
              <p className="support-fineprint">
                ${price.toFixed(2)} is charged to your account wallet. After payment you’ll get the scheduling link.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
