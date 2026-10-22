import React, { useEffect, useMemo, useRef, useState } from 'react';
import { sanitizeHtml } from '../lib/sanitizeHtml.js';

/**
 * An email body rendered in its own sandboxed iframe — ported from PipelinePulse.
 *
 * WHY AN IFRAME. Injected into the page, an email takes on OUR app's styles and its own wide tables /
 * inline sizes fight the bubble around it. In a frame the email keeps its own look and nothing leaks
 * either way. STILL SANITIZED: the body goes through sanitizeHtml first; the sandbox omits
 * allow-scripts so nothing can run even if markup slipped through. Sized to its content — no inner
 * scrollbar; the height is measured on load and whenever the body resizes (images, the card narrowing).
 */
const FRAME_CSS = `
  html { overflow-y: hidden; overflow-x: auto; }
  body {
    margin: 0;
    font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    font-size: 14px; line-height: 1.5; color: #1f2937;
    overflow-wrap: anywhere;
  }
  p { margin: 0 0 0.6em; }
  p:last-child { margin-bottom: 0; }
  img { max-width: 100%; height: auto; }
  a { color: #2563eb; }
  table { border-collapse: collapse; max-width: 100%; }
  blockquote { margin: 0.4em 0; padding-left: 10px; border-left: 3px solid #d1d5db; color: #6b7280; }
`;

export default function EmailFrame({ html, title = 'Email message', onResize }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(0);

  const srcDoc = useMemo(() => (
    '<!doctype html><html><head><meta charset="utf-8">'
    + '<base target="_blank">' // links open in a new tab, never inside the frame
    + `<style>${FRAME_CSS}</style></head><body>`
    + sanitizeHtml(html || '')
    + '</body></html>'
  ), [html]);

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return undefined;
    let observer = null;
    const measure = () => {
      const body = frame.contentDocument?.body;
      if (!body) return;
      const doc = frame.contentDocument.documentElement;
      const bar = doc.scrollWidth > doc.clientWidth ? 14 : 0; // room for a horizontal scrollbar
      setHeight(Math.ceil(body.getBoundingClientRect().height) + bar);
      // Let the parent re-position (e.g. a thread that wants to stay scrolled to the bottom) now that
      // this frame's real height is known — otherwise its initial 20px height throws scrolling off.
      if (typeof onResize === 'function') onResize();
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (observer) { observer.disconnect(); observer = null; }
      if (body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener('load', onLoad);
    if (frame.contentDocument?.readyState === 'complete') onLoad(); // srcdoc can finish before listener
    return () => {
      frame.removeEventListener('load', onLoad);
      if (observer) observer.disconnect();
    };
  }, [srcDoc]);

  return (
    <iframe
      ref={ref}
      title={title}
      srcDoc={srcDoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      style={{ display: 'block', width: '100%', height: height || 20, border: 0, background: 'transparent' }}
    />
  );
}
