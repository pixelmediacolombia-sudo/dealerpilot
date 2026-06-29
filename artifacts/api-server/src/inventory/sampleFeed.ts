// A realistic dealer inventory feed for Alpha Motorsport, used as the default
// sample XML feed. The XML structure here is intentionally one common shape
// (<inventory><vehicle>...). The parser in xmlEngine.ts is flexible and handles
// other real-world shapes/field names too.

type SampleVehicle = {
  vin: string;
  stock: string;
  year: number;
  make: string;
  model: string;
  trim?: string;
  mileage: number;
  price: number;
  exterior: string;
  interior: string;
  body: string;
  transmission: string;
  fuel: string;
  description: string;
  images: string[];
};

const IMG = (slug: string, n = 3): string[] =>
  Array.from({ length: n }, (_, i) => `/sample-vehicles/${slug}.png?v=${i + 1}`);

// Base inventory (v1 — first sync). Prices/mileage here represent the initial pull.
const BASE: SampleVehicle[] = [
  {
    vin: "1FA6P8CF5N5100001",
    stock: "AM-1001",
    year: 2022,
    make: "Ford",
    model: "Mustang",
    trim: "GT Premium",
    mileage: 18240,
    price: 41995,
    exterior: "Race Red",
    interior: "Ebony",
    body: "Coupe",
    transmission: "6-Speed Manual",
    fuel: "Gasoline",
    description:
      "5.0L V8, active valve exhaust, Recaro seats. Clean Carfax, one owner.",
    images: IMG("mustang-gt"),
  },
  {
    vin: "1G1FH1R75M0100002",
    stock: "AM-1002",
    year: 2021,
    make: "Chevrolet",
    model: "Camaro",
    trim: "2SS",
    mileage: 24110,
    price: 39450,
    exterior: "Black",
    interior: "Adrenaline Red",
    body: "Coupe",
    transmission: "10-Speed Automatic",
    fuel: "Gasoline",
    description: "6.2L V8, magnetic ride control, head-up display.",
    images: IMG("camaro-ss"),
  },
  {
    vin: "2C3CDZBT5PH100003",
    stock: "AM-1003",
    year: 2023,
    make: "Dodge",
    model: "Challenger",
    trim: "R/T Scat Pack",
    mileage: 9870,
    price: 47990,
    exterior: "Go Mango",
    interior: "Black",
    body: "Coupe",
    transmission: "8-Speed Automatic",
    fuel: "Gasoline",
    description: "392 HEMI, widebody, Harman Kardon audio.",
    images: IMG("challenger-rt"),
  },
  {
    vin: "WBS83CD05L5100004",
    stock: "AM-1004",
    year: 2020,
    make: "BMW",
    model: "M4",
    trim: "Competition",
    mileage: 31500,
    price: 52900,
    exterior: "Yas Marina Blue",
    interior: "Silverstone",
    body: "Coupe",
    transmission: "7-Speed DCT",
    fuel: "Gasoline",
    description: "Carbon roof, M Driver's Package, premium sound.",
    images: IMG("bmw-m4"),
  },
  {
    vin: "WAUB4CF53NA100005",
    stock: "AM-1005",
    year: 2022,
    make: "Audi",
    model: "S5",
    trim: "Prestige",
    mileage: 15600,
    price: 48750,
    exterior: "Daytona Gray",
    interior: "Black",
    body: "Coupe",
    transmission: "8-Speed Automatic",
    fuel: "Gasoline",
    description: "Quattro AWD, Bang & Olufsen, virtual cockpit plus.",
    images: IMG("audi-s5"),
  },
  {
    vin: "WP0AA2A99KS100006",
    stock: "AM-1006",
    year: 2019,
    make: "Porsche",
    model: "911",
    trim: "Carrera",
    mileage: 27800,
    price: 89900,
    exterior: "Carrara White",
    interior: "Black",
    body: "Coupe",
    transmission: "8-Speed PDK",
    fuel: "Gasoline",
    description: "Sport Chrono, PASM, Bose surround sound.",
    images: IMG("porsche-911"),
  },
  {
    vin: "JT2BF22K1W0100007",
    stock: "AM-1007",
    year: 2021,
    make: "Toyota",
    model: "GR Supra",
    trim: "3.0 Premium",
    mileage: 12400,
    price: 51200,
    exterior: "Renaissance Red",
    interior: "Black",
    body: "Coupe",
    transmission: "8-Speed Automatic",
    fuel: "Gasoline",
    description: "3.0L turbo I6, JBL audio, wireless Apple CarPlay.",
    images: IMG("supra"),
  },
  {
    vin: "JF1VA2M67N9100008",
    stock: "AM-1008",
    year: 2023,
    make: "Subaru",
    model: "WRX",
    trim: "Limited",
    mileage: 8100,
    price: 36400,
    exterior: "WR Blue Pearl",
    interior: "Black Ultrasuede",
    body: "Sedan",
    transmission: "6-Speed Manual",
    fuel: "Gasoline",
    description: "Symmetrical AWD, Harman Kardon, moonroof.",
    images: IMG("wrx"),
  },
  {
    vin: "5YJ3E1EB8LF100009",
    stock: "AM-1009",
    year: 2020,
    make: "Tesla",
    model: "Model 3",
    trim: "Performance",
    mileage: 33250,
    price: 34900,
    exterior: "Pearl White",
    interior: "Black",
    body: "Sedan",
    transmission: "Single-Speed",
    fuel: "Electric",
    description: "Dual motor AWD, full self-driving hardware, track mode.",
    images: IMG("model3"),
  },
  {
    vin: "1G1YY2D75J5100010",
    stock: "AM-1010",
    year: 2018,
    make: "Chevrolet",
    model: "Corvette",
    trim: "Grand Sport",
    mileage: 21900,
    price: 58995,
    exterior: "Corvette Racing Yellow",
    interior: "Jet Black",
    body: "Coupe",
    transmission: "7-Speed Manual",
    fuel: "Gasoline",
    description: "Z51 package, removable roof panel, performance data recorder.",
    images: IMG("corvette"),
  },
  {
    vin: "1C4HJXFG5NW100011",
    stock: "AM-1011",
    year: 2022,
    make: "Jeep",
    model: "Wrangler",
    trim: "Rubicon",
    mileage: 19450,
    price: 44300,
    exterior: "Sarge Green",
    interior: "Black",
    body: "SUV",
    transmission: "8-Speed Automatic",
    fuel: "Gasoline",
    description: "4x4, rock-trac, removable doors and top.",
    images: IMG("wrangler"),
  },
  {
    vin: "1FTFW1RG5MFA10012",
    stock: "AM-1012",
    year: 2021,
    make: "Ford",
    model: "F-150",
    trim: "Raptor",
    mileage: 28700,
    price: 64900,
    exterior: "Agate Black",
    interior: "Black",
    body: "Truck",
    transmission: "10-Speed Automatic",
    fuel: "Gasoline",
    description: "3.5L EcoBoost HO, FOX live valve, 360 camera.",
    images: IMG("raptor"),
  },
  {
    vin: "SHHFK8G70LU100013",
    stock: "AM-1013",
    year: 2020,
    make: "Honda",
    model: "Civic",
    trim: "Type R",
    mileage: 26500,
    price: 38900,
    exterior: "Championship White",
    interior: "Black/Red",
    body: "Hatchback",
    transmission: "6-Speed Manual",
    fuel: "Gasoline",
    description: "2.0L turbo, limited slip differential, Brembo brakes.",
    images: IMG("civic-typer"),
  },
];

// A vehicle that exists only in v1 and is removed in v2 (to trigger Sold/Removed).
const RETIRED: SampleVehicle = {
  vin: "JN1AZ4EH2NM100014",
  stock: "AM-1014",
  year: 2021,
  make: "Nissan",
  model: "370Z",
  trim: "Sport",
  mileage: 41200,
  price: 32900,
  exterior: "Chicane Yellow",
  interior: "Black",
  body: "Coupe",
  transmission: "6-Speed Manual",
  fuel: "Gasoline",
  description: "3.7L V6, SynchroRev Match, Bose audio.",
  images: IMG("nissan-z"),
};

// A vehicle that appears only in v2 (a fresh arrival -> stays "New").
const ARRIVAL: SampleVehicle = {
  vin: "JN1BZ4EH9PM100015",
  stock: "AM-1015",
  year: 2023,
  make: "Nissan",
  model: "Z",
  trim: "Performance",
  mileage: 3400,
  price: 49900,
  exterior: "Ikazuchi Yellow",
  interior: "Black",
  body: "Coupe",
  transmission: "6-Speed Manual",
  fuel: "Gasoline",
  description: "3.0L twin-turbo V6, launch control, Bose premium audio.",
  images: IMG("nissan-z"),
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function vehicleToXml(v: SampleVehicle): string {
  const images = v.images
    .map((url) => `        <image>${escapeXml(url)}</image>`)
    .join("\n");
  return `    <vehicle>
      <vin>${v.vin}</vin>
      <stock_number>${escapeXml(v.stock)}</stock_number>
      <year>${v.year}</year>
      <make>${escapeXml(v.make)}</make>
      <model>${escapeXml(v.model)}</model>
      <trim>${escapeXml(v.trim ?? "")}</trim>
      <mileage>${v.mileage}</mileage>
      <price>${v.price}</price>
      <exterior_color>${escapeXml(v.exterior)}</exterior_color>
      <interior_color>${escapeXml(v.interior)}</interior_color>
      <body_style>${escapeXml(v.body)}</body_style>
      <transmission>${escapeXml(v.transmission)}</transmission>
      <fuel_type>${escapeXml(v.fuel)}</fuel_type>
      <description>${escapeXml(v.description)}</description>
      <vdp_url>https://www.alphamotorsport.example/inventory/${escapeXml(v.stock)}</vdp_url>
      <images>
${images}
      </images>
    </vehicle>`;
}

function buildFeed(vehicles: SampleVehicle[]): string {
  const body = vehicles.map(vehicleToXml).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<inventory dealer="Alpha Motorsport" generated="${new Date().toISOString()}">
${body}
</inventory>
`;
}

// v1: the initial pull (includes RETIRED, excludes ARRIVAL).
export function buildSampleFeedV1(): string {
  return buildFeed([...BASE, RETIRED]);
}

// v2 (current/live feed): RETIRED is gone, ARRIVAL is added, and two vehicles
// changed: a price drop on the Mustang and a mileage bump on the Camaro.
export function buildSampleFeedV2(): string {
  const changed = BASE.map((v) => {
    if (v.stock === "AM-1001") return { ...v, price: 39995 };
    if (v.stock === "AM-1002") return { ...v, mileage: 25340 };
    return v;
  });
  return buildFeed([...changed, ARRIVAL]);
}

export const CURRENT_SAMPLE_FEED = buildSampleFeedV2;
