import { useRef, type ReactNode } from "react";
import type { LoadedBundle } from "../scene/loadBundle";

const URL_IN_TEXT = /(https?:\/\/[^\s,;)]*[^\s,;).])/; // a URL, without the full stop that ends its sentence

// Text with any URLs in it made clickable.
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_IN_TEXT).map((part, i) =>
        URL_IN_TEXT.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Source({ name, url, children }: { name: string; url?: string; children?: ReactNode }) {
  return (
    <li>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {name}
        </a>
      ) : (
        <strong>{name}</strong>
      )}
      {children && <div className="muted">{children}</div>}
    </li>
  );
}

// One button that opens every source and link of the scene, grouped. The panels only carry a short
// resolution-and-source line per layer; the full citations live here.
export function SourcesDialog({ bundle }: { bundle: LoadedBundle }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { manifest, pins, rasters, shielding, splatLayers } = bundle;
  const pinUrls = (pin: LoadedBundle["pins"][number]) => pin.source_urls.filter((url) => !pin.measurements.some((m) => m.source_url === url));

  return (
    <div className="sources-bar">
      <button onClick={() => dialog.current?.showModal()}>Sources</button>
      <dialog ref={dialog} className="sources" onClick={(e) => e.target === dialog.current && dialog.current.close()}>
        <div className="sources-head">
          <h1>Sources: {manifest.title}</h1>
          <button onClick={() => dialog.current?.close()} aria-label="Close sources">
            Close
          </button>
        </div>

        <h2>Terrain and scene</h2>
        <ul>
          {manifest.sources.map((source) => (
            <Source key={source.name} name={source.name} url={source.url} />
          ))}
        </ul>
        <p className="muted small">Map projection: {manifest.map_crs}</p>

        {manifest.splat && (
          <>
            <h2>Splat</h2>
            <p className="small">
              {manifest.splat.count.toLocaleString()} Gaussians reconstructed by this project from the rover's own photos
              of the site{manifest.splat.crop_radius_m ? `, cropped to ${manifest.splat.crop_radius_m} m around the target` : ""}.
              It is a reconstruction, not a measurement.
            </p>
          </>
        )}

        {splatLayers && (
          <>
            <h2>Splat layers</h2>
            <ul>
              {splatLayers.schema.fields.map((field) => (
                <Source key={field.name} name={field.name + (field.estimate ? " (estimate)" : "")}>
                  <Linked text={`${field.source ?? "source not stated"}. Resolution: ${field.resolution ?? "not stated"}.`} />
                </Source>
              ))}
            </ul>
          </>
        )}

        {rasters.length > 0 && (
          <>
            <h2>Terrain layers</h2>
            <ul>
              {rasters.map((raster) => (
                <Source key={raster.name} name={raster.name + (raster.estimate ? " (estimate)" : "")} url={raster.source_url}>
                  <Linked text={`${raster.source}. Resolution: ${raster.resolution}.`} />
                </Source>
              ))}
            </ul>
          </>
        )}

        {pins.length > 0 && (
          <>
            <h2>Pins</h2>
            <ul>
              {pins.map((pin) => (
                <Source key={pin.id} name={pin.name}>
                  {pin.measurements.map((m) => (
                    <div key={m.label}>
                      <a href={m.source_url} target="_blank" rel="noreferrer">
                        {m.label}
                      </a>
                    </div>
                  ))}
                  {pinUrls(pin).map((url) => (
                    <div key={url}>
                      <Linked text={url} />
                    </div>
                  ))}
                </Source>
              ))}
            </ul>
          </>
        )}

        {shielding && (
          <>
            <h2>Shielding</h2>
            <ul>
              <Source name={shielding.source.citation} url={shielding.source.url}>
                {shielding.limits}
              </Source>
            </ul>
          </>
        )}
      </dialog>
    </div>
  );
}
