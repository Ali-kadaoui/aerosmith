import { useState } from 'react';
import { ArrowUpRight, Bookmark, Camera, MapPin, Search, X } from 'lucide-react';
import { coord, type Feature, type Observation, type Source } from './model';

export function ScienceCatalogue({ features, onSelect }: { features: Feature[]; onSelect: (feature: Feature) => void }) {
  const [query, setQuery] = useState('');
  const matches = features.filter(feature => [feature.name, feature.subtitle, feature.region, feature.category].join(' ').toLowerCase().includes(query.toLowerCase().trim()));
  return <div className="catalogue">
    <label className="search"><Search size={15}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a feature" aria-label="Search scientific features"/></label>
    {matches.map(feature => <button className="feature-row" key={feature.id} onClick={() => onSelect(feature)}>
      {feature.coordinate ? <MapPin size={16} /> : <Bookmark size={16} />}<span><b>{feature.name}</b><small>{feature.subtitle}</small></span><ArrowUpRight size={14}/>
    </button>)}
    {!matches.length && <p className="muted">No matching features.</p>}
  </div>;
}
export function Dossier({ feature, observations, onClose, onLocate, onUse, onImage }: {
  feature: Feature; observations: Observation[]; onClose: () => void; onLocate: () => void;
  onUse: (index: number) => void; onImage: (item: Observation) => void;
}) {
  const image = observations.find(item => item.featureId === feature.id);
  return <article className="dossier">
    <div className="section-label">{feature.category} · {feature.region}<button className="icon subtle" aria-label="Close dossier" onClick={onClose}><X size={17}/></button></div>
    <h3>{feature.name}</h3><p>{feature.description}</p>
    {image && <button className="dossier-image" onClick={() => onImage(image)}><img src={image.image} alt={image.title}/><span><Camera size={14}/>{image.title}</span></button>}
    <div className="dossier-coordinate">{feature.coordinate ? coord(feature.coordinate, 4) : 'Catalogue entry'}</div>
    <p className="muted">{feature.accuracy}</p>
    {feature.coordinate && <div className="dossier-actions"><button className="secondary" onClick={onLocate}>Locate</button>{feature.region === 'Gale Crater' && <><button className="secondary" onClick={() => onUse(0)}>Set A</button><button className="secondary" onClick={() => onUse(1)}>Set B</button></>}</div>}
    <a className="source-link" href={feature.url} target="_blank" rel="noreferrer">Scientific reference <ArrowUpRight size={13}/></a>
  </article>;
}
export function Gallery({ observations, onImage }: { observations: Observation[]; onImage: (item: Observation) => void }) {
  const [mission, setMission] = useState('Curiosity');
  const [query, setQuery] = useState('');
  const items = observations.filter(item => item.mission === mission && [item.title, item.camera, item.id].join(' ').toLowerCase().includes(query.toLowerCase().trim()));
  return <main className="library">
    <div className="library-heading"><div className="kicker">NASA / JPL ARCHIVE</div><h1>Rover observations</h1><p>Published imagery and historical context for each mission region.</p></div>
    <div className="gallery-filters"><div className="segmented"><button className={mission === 'Curiosity' ? 'active' : ''} onClick={() => setMission('Curiosity')}>Curiosity · Gale</button><button className={mission === 'Perseverance' ? 'active' : ''} onClick={() => setMission('Perseverance')}>Perseverance · Jezero</button></div>
      <label className="search"><Search size={16}/><input placeholder="Filter observations" aria-label="Filter observations" value={query} onChange={event => setQuery(event.target.value)}/></label></div>
    <div className="gallery-grid">{items.map(item => <button className="gallery-card" key={item.id} onClick={() => onImage(item)}>
      <img src={item.image} alt={item.title} /><div><span className="kicker">{item.id} / {item.camera}</span><h2>{item.title}</h2><p>{item.sol ? `Sol ${item.sol} · ${item.date}` : 'Historical planning illustration'}</p></div>
    </button>)}</div>{!items.length && <p className="muted">No matching observations.</p>}
  </main>;
}
export function Sources({ sources }: { sources: Source[] }) {
  return <main className="library">
    <div className="library-heading"><div className="kicker">PROVENANCE / COVERAGE</div><h1>Data registry</h1><p>Archival observations, processed products and reference material.</p></div>
    <div className="registry">{sources.map(source => <article key={source.id}>
      <div className="section-label">{source.source}<span>{source.status}</span></div><h2>{source.name}</h2><p>{source.description}</p>
      <dl><dt>Coverage</dt><dd>{source.coverage}</dd><dt>Resolution</dt><dd>{source.resolution}</dd><dt>CRS</dt><dd>{source.crs}</dd><dt>Credit</dt><dd>{source.attribution}</dd></dl>
      <a className="source-link" href={source.url} target="_blank" rel="noreferrer">Original source <ArrowUpRight size={14}/></a>
    </article>)}</div>
  </main>;
}
