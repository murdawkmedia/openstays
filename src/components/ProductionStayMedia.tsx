import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

type StayMediaProps = {
  propertySlug: string;
  propertyName: string;
  amenities: string[];
  photoUrls: string[];
};

export function StayMedia({ propertyName, amenities, photoUrls }: StayMediaProps) {
  const media = photoUrls.map((src, index) => ({
    src,
    alt: `${propertyName} property photo ${index + 1}`,
    caption: `${propertyName} — photo ${index + 1}`,
  }));
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (activeIndex !== null && dialog && !dialog.open) dialog.showModal();
  }, [activeIndex]);

  function openGallery(index: number, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setActiveIndex(index);
  }

  function closeGallery() { dialogRef.current?.close(); }
  function handleClosed() { setActiveIndex(null); lastTriggerRef.current?.focus(); }
  function move(delta: number) {
    if (activeIndex === null || media.length === 0) return;
    setActiveIndex((activeIndex + delta + media.length) % media.length);
  }

  return (
    <>
      {amenities.length > 0 ? (
        <div className="mt-5 flex flex-wrap gap-2" aria-label="Stay features">
          {amenities.map((amenity) => <span key={amenity} className="badge bg-stone-100 text-stone-700">{amenity}</span>)}
        </div>
      ) : null}
      {media.length > 0 ? (
        <section className="mt-7" aria-labelledby="stay-gallery-title">
          <h2 id="stay-gallery-title" className="mb-3 font-display text-xl font-semibold text-stone-900">Property photos</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {media.map((image, index) => (
              <button
                key={image.src}
                type="button"
                className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-stone-200 text-left shadow-sm ring-1 ring-stone-900/10 transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                onClick={(event) => openGallery(index, event.currentTarget)}
                aria-label={`Open property photo: ${image.caption}`}
              >
                <img className="h-full w-full object-cover" src={image.src} alt={image.alt} loading={index === 0 ? 'eager' : 'lazy'} />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-stone-950/90 to-transparent px-4 pb-3 pt-10 text-sm font-medium text-white">{image.caption}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <dialog
        ref={dialogRef}
        className="m-auto w-[min(94vw,72rem)] overflow-hidden rounded-3xl bg-stone-950 p-0 text-white shadow-2xl backdrop:bg-stone-950/85"
        onCancel={(event) => { event.preventDefault(); closeGallery(); }}
        onClose={handleClosed}
        onClick={(event) => { if (event.target === event.currentTarget) closeGallery(); }}
      >
        {activeIndex !== null && media[activeIndex] ? (
          <div className="relative">
            <img className="max-h-[78vh] w-full object-contain" src={media[activeIndex].src} alt={media[activeIndex].alt} />
            <div className="flex items-center justify-between gap-3 px-5 py-4">
              <div><p className="font-medium">{media[activeIndex].caption}</p><p className="text-xs text-stone-400">{activeIndex + 1} of {media.length}</p></div>
              <div className="flex gap-2">
                <button type="button" className="rounded-full border border-white/20 p-2" onClick={() => move(-1)} aria-label="Previous property photo"><ChevronLeft aria-hidden="true" /></button>
                <button type="button" className="rounded-full border border-white/20 p-2" onClick={() => move(1)} aria-label="Next property photo"><ChevronRight aria-hidden="true" /></button>
                <button type="button" className="rounded-full border border-white/20 p-2" onClick={closeGallery} aria-label="Close property photo"><X aria-hidden="true" /></button>
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
