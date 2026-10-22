// Phase 1 sports. More sports get added here (and later come from the database).
// `ready: false` means the sport is listed but its setup is not built yet.
export const SPORTS = [
  {
    slug: "table-tennis",
    name: "Table Tennis",
    tagline: "Singles · Doubles · All ages",
    gradient: "linear-gradient(135deg, #2b2bff 0%, #00a6ff 100%)",
    ready: true,
  },
  {
    slug: "badminton",
    name: "Badminton",
    tagline: "Singles · Doubles · All ages",
    gradient: "linear-gradient(135deg, #ff2d6f 0%, #ff9440 100%)",
    ready: false,
  },
];

export const getSport = (slug) => SPORTS.find((s) => s.slug === slug);
