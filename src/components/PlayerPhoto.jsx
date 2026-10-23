import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";

export const TSHIRT_SIZES = ["Kids S", "Kids M", "Kids L", "XS", "S", "M", "L", "XL", "XXL", "3XL"];

// Shrinks a picked photo to a small square-ish JPEG (about 20 to 40 KB) so it is quick to save and load.
export function shrinkPhoto(file, max = 320) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

// Round picture of a player, or their initial when there is no photo.
export function Avatar({ name = "", photo = "", size = 44 }) {
  return photo ? (
    <img src={photo} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-full bg-surface-2 font-display font-extrabold italic" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// Optional photo field: opens the phone's camera or gallery.
export function PhotoPicker({ value, name, onChange }) {
  const input = useRef(null);
  const [error, setError] = useState("");
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setError("");
      onChange(await shrinkPhoto(file));
    } catch {
      setError("That file could not be read as a photo. Try another.");
    }
  }
  return (
    <div>
      <div className="flex items-center gap-4">
        <Avatar name={name} photo={value} size={64} />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => input.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-full bg-surface-2 px-4 text-sm font-bold">
            <Camera size={16} aria-hidden="true" /> {value ? "Change photo" : "Add photo"}
          </button>
          {value && (
            <button type="button" onClick={() => onChange("")} className="inline-flex h-10 items-center gap-1 rounded-full px-3 text-sm font-bold text-muted">
              <X size={16} aria-hidden="true" /> Remove
            </button>
          )}
        </div>
      </div>
      <input ref={input} type="file" accept="image/*" onChange={pick} className="sr-only" tabIndex={-1} aria-label="Choose a photo" />
      {error && <p className="mt-2 text-sm text-[#fca5a5]">{error}</p>}
    </div>
  );
}
