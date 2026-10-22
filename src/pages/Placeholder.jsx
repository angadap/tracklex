export default function Placeholder({ title, note }) {
  return (
    <div className="mx-auto max-w-md px-6 pt-10">
      <h1 className="font-display text-[56px] font-extrabold italic uppercase leading-[0.95]">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-soft">{note}</p>
    </div>
  );
}
