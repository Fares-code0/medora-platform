import { useCallback, useEffect, useRef, useState } from 'react';

import { ImageUp, Maximize, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';

import { Avatar, Button, Modal } from '@/components/ui';

/**
 * Profile photo field — an avatar preview with Upload / Change / Remove, plus
 * a real image editor (move, zoom, center, reset, circular crop, live
 * preview, cancel, save). The editor renders the chosen crop to a square
 * canvas and returns a data URL; the avatar then updates everywhere through
 * the DoctorProfileProvider. No external dependency — plain canvas + pointer
 * events.
 */

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // 4 MB source; the crop is re-encoded small.
const EDIT_SIZE = 264; // editor canvas (px)
const OUTPUT_SIZE = 256; // exported avatar (px)
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

export interface ProfilePhotoFieldProps {
  name: string;
  value: string | null;
  onChange: (value: string | null) => void;
  onError: (message: string) => void;
  /** Avatar role ring, matching the profile owner's role surface. */
  roleRing?: 'doctor' | 'staff' | undefined;
  /**
   * Whether "Remove" is offered. False where nothing can remove a stored
   * photo — the live profile has an upload route and no removal route.
   */
  removable?: boolean;
  /** While a save of the chosen photo is in flight. */
  busy?: boolean;
}

export function ProfilePhotoField({
  name,
  value,
  onChange,
  onError,
  roleRing,
  removable = true,
  busy = false,
}: ProfilePhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [editorSrc, setEditorSrc] = useState<string | null>(null);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onError('Choose an image file.');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      onError('Keep the image under 4 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setEditorSrc(typeof reader.result === 'string' ? reader.result : null);
    reader.onerror = () => onError('Could not read that file.');
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar name={name || 'User'} src={value ?? undefined} size="xl" roleRing={roleRing} />
      <div className="flex flex-col gap-2">
        <p className="text-body-sm font-medium text-text-primary">Profile photo</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            leadingIcon={ImageUp}
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {value ? 'Change photo' : 'Upload photo'}
          </Button>
          {value && removable ? (
            <Button type="button" variant="ghost" size="sm" leadingIcon={Trash2} onClick={() => onChange(null)}>
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-caption text-text-secondary">
          JPG or PNG. You can zoom, move, and crop before saving.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onFile}
          aria-label="Upload profile photo"
        />
      </div>

      {editorSrc ? (
        <PhotoEditorModal
          src={editorSrc}
          onCancel={() => setEditorSrc(null)}
          onSave={(dataUrl) => {
            onChange(dataUrl);
            setEditorSrc(null);
          }}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────────── */

interface Transform {
  zoom: number;
  x: number;
  y: number;
}

const CENTERED: Transform = { zoom: 1, x: 0, y: 0 };

function PhotoEditorModal({
  src,
  onCancel,
  onSave,
  onError,
}: {
  src: string;
  onCancel: () => void;
  onSave: (dataUrl: string) => void;
  onError: (message: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);
  const [transform, setTransform] = useState<Transform>(CENTERED);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );

  // Load the source image.
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setReady(true);
    };
    img.onerror = () => onError('Could not load that image.');
    img.src = src;
  }, [src, onError]);

  /** Cover-fit base scale so the image always fills the frame at zoom 1. */
  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, size: number, t: Transform) => {
      const img = imageRef.current;
      if (!img) return;
      const cover = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const s = cover * t.zoom;
      const dw = img.naturalWidth * s;
      const dh = img.naturalHeight * s;
      const scaleRatio = size / EDIT_SIZE;
      const dx = (size - dw) / 2 + t.x * scaleRatio;
      const dy = (size - dh) / 2 + t.y * scaleRatio;
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, dx, dy, dw, dh);
    },
    [],
  );

  // Render to the editor canvas whenever the transform changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ready) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    draw(ctx, EDIT_SIZE, transform);
  }, [ready, transform, draw]);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      origX: transform.x,
      origY: transform.y,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setTransform((t) => ({
      ...t,
      x: drag.origX + (event.clientX - drag.startX),
      y: drag.origY + (event.clientY - drag.startY),
    }));
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  const setZoom = (zoom: number) =>
    setTransform((t) => ({ ...t, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) }));

  const save = () => {
    const out = document.createElement('canvas');
    out.width = OUTPUT_SIZE;
    out.height = OUTPUT_SIZE;
    const ctx = out.getContext('2d');
    if (!ctx) {
      onError('Could not process the image.');
      return;
    }
    // Circular crop so the saved avatar is genuinely round.
    ctx.save();
    ctx.beginPath();
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    draw(ctx, OUTPUT_SIZE, transform);
    ctx.restore();
    onSave(out.toDataURL('image/png'));
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title="Edit profile photo"
      description="Drag to move, zoom to frame, then crop to a circle."
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!ready}>
            Save photo
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-4">
        {/* Editor with circular crop guide */}
        <div className="relative h-[264px] w-[264px] overflow-hidden rounded-surface bg-surface-sunken">
          <canvas
            ref={canvasRef}
            width={EDIT_SIZE}
            height={EDIT_SIZE}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="h-full w-full cursor-grab touch-none active:cursor-grabbing"
          />
          {/* Circular crop frame — the area kept when you save. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-pill border-2 border-dashed border-surface shadow-[0_0_0_2px_rgba(11,13,15,0.25)]"
          />
        </div>

        {/* Zoom controls */}
        <div className="flex w-full max-w-[264px] items-center gap-3">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => setZoom(transform.zoom - 0.25)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-surface text-text-secondary hover:bg-surface-sunken"
          >
            <Minus className="h-4 w-4" strokeWidth={2} />
          </button>
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={transform.zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
            aria-label="Zoom"
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-pill bg-border accent-primary"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => setZoom(transform.zoom + 0.25)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-surface text-text-secondary hover:bg-surface-sunken"
          >
            <Plus className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={Maximize}
            onClick={() => setTransform((t) => ({ ...t, x: 0, y: 0 }))}
          >
            Center
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leadingIcon={RotateCcw}
            onClick={() => setTransform(CENTERED)}
          >
            Reset
          </Button>
        </div>
      </div>
    </Modal>
  );
}
