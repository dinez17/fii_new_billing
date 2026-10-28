import { badRequest } from "@fii/common";

const codes: Record<string, string> = {
  "jammu and kashmir": "01", "himachal pradesh": "02", punjab: "03", chandigarh: "04", uttarakhand: "05", haryana: "06", delhi: "07", rajasthan: "08", "uttar pradesh": "09", bihar: "10", sikkim: "11", "arunachal pradesh": "12", nagaland: "13", manipur: "14", mizoram: "15", tripura: "16", meghalaya: "17", assam: "18", "west bengal": "19", jharkhand: "20", odisha: "21", orissa: "21", chhattisgarh: "22", "madhya pradesh": "23", gujarat: "24", "dadra and nagar haveli and daman and diu": "26", "dadra and nagar haveli": "26", "daman and diu": "26", maharashtra: "27", karnataka: "29", goa: "30", lakshadweep: "31", kerala: "32", "tamil nadu": "33", puducherry: "34", pondicherry: "34", "andaman and nicobar islands": "35", telangana: "36", "andhra pradesh": "37", ladakh: "38",
};
export function parsePostalResult(data: unknown, pincode: string) {
  const rows = data as { Status?: string; PostOffice?: { District?: string; State?: string; Name?: string; Pincode?: string }[] }[];
  const offices = Array.isArray(rows) && rows[0]?.Status === "Success" ? rows[0].PostOffice : undefined;
  const office = offices?.find((item) => item.Pincode === pincode && item.State && item.District);
  if (!office) throw badRequest("PIN code not found. Check it or enter the address manually.");
  const state = office.State!;
  const stateCode = codes[state.toLowerCase().replace(/&/g, "and").replace(/\s+/g, " ").trim()];
  if (!stateCode) throw badRequest("State code unavailable; enter the address manually.");
  return { pincode, city: office.District!, state, stateCode };
}
export async function lookupPincode(pincode: string) {
  if (!/^[1-9][0-9]{5}$/.test(pincode)) throw badRequest("Enter a valid 6-digit PIN code");
  try {
    const response = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("Postal API unavailable");
    return parsePostalResult(await response.json(), pincode);
  } catch (err) {
    if (err instanceof Error && "statusCode" in err) throw err;
    throw badRequest("PIN lookup unavailable. You can enter city, state and state code manually.");
  }
}
