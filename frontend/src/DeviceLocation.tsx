import { watchEarthLocation, locationErrorMessage } from './deviceTracking';
import { useEffect, useRef, useState } from 'react';

export function DeviceLocation() {
  const watcher = useRef<(() => void) | null>(null);
  const generation = useRef(0);
  const [tracking, setTracking] = useState(false);
  const [status, setStatus] = useState('Tracking off');
  const [position, setPosition] = useState<{ lat: number; lon: number; accuracy: number; time: number } | null>(null);
  function stop() {
    generation.current++;
    if (watcher.current !== null) watcher.current();
    watcher.current = null;
    setTracking(false);
    setPosition(null);
    setStatus('Tracking off');
  }
  useEffect(() => () => {
    generation.current++;
    if (watcher.current !== null) watcher.current();
  }, []);
  function start() {
    stop();
    if (!window.isSecureContext) { setStatus('Device location requires HTTPS or localhost.'); return; }
    if (!navigator.geolocation) { setStatus('This browser does not support device location.'); return; }
    const ticket = generation.current;
    setTracking(true);
    setStatus('Requesting Earth device location…');
    try {
      watcher.current = watchEarthLocation(navigator.geolocation, result => {
        if (ticket !== generation.current) return;
        setPosition({ lat: result.coords.latitude, lon: result.coords.longitude, accuracy: result.coords.accuracy, time: result.timestamp });
        setStatus('Receiving Earth location updates');
      }, error => {
        if (ticket !== generation.current) return;
        setPosition(null);
        if (error.code === 1) stop();
        setStatus(locationErrorMessage(error.code));
      });
    } catch {
      stop();
      setStatus('Device location could not start. Check browser permissions.');
    }
  }
  return <details className="device-location"><summary>Earth device location</summary>
    <p>Your browser requests permission when you start. Coordinates stay in memory and are cleared when tracking stops. Earth location is separate from your Mars itinerary.</p>
    <p role="status">{status}</p>
    {position && <output>Earth · {position.lat.toFixed(5)}°, {position.lon.toFixed(5)}° · Accuracy ±{Math.round(position.accuracy)} m · Updated {new Date(position.time).toLocaleTimeString()}</output>}
    <button type="button" className="secondary" onClick={tracking ? stop : start}>{tracking ? 'Stop Earth tracking' : 'Start Earth tracking'}</button>
  </details>;
}
