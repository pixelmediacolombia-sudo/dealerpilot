// Sanitized Vincue shape for Lucki-only parser/fetch tests.
// This fixture is intentionally separate from Alpha's sampleFeed.ts.
export const LUCKI_MAZDA_INNER_XML = `<?xml version="1.0"?>
  <inventory>
    <vehicle>
      <dealer_id>148954</dealer_id><dealer_name>Lucki Mazda (sanitized)</dealer_name>
      <vin>1SANITIZEDVIN0001</vin><stock_number>U00016</stock_number>
      <vehicle_id>VINCUE-VEHICLE-0001</vehicle_id>
      <year>2022</year><make>Mazda</make><model>CX-5</model><trim>Touring</trim>
      <mileage>31000</mileage><price>24995</price>
      <body_style>SUV</body_style><transmission>Automatic</transmission><fuel_type>Gasoline</fuel_type>
      <description>Sanitized vehicle description</description>
      <vdp_url>https://dealer.example.test/vdp/U00016</vdp_url>
      <availability>available</availability>
      <images>
        <image><url>https://images.example.test/U00016-1.jpg</url><tag>exterior</tag></image>
        <image><url>https://images.example.test/U00016-2.jpg</url><tag>interior</tag></image>
      </images>
    </vehicle>
  </inventory>`;

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export const LUCKI_MAZDA_SERIALIZED_XML = `<string>${escapeXml(LUCKI_MAZDA_INNER_XML)}</string>`;
