import {badRequest} from "@fii/common";
/** Embedded raster images only: never fetch external URLs or accept SVG markup. */
export function validateSignatureImage(value:unknown):string {
 if(typeof value!=="string"||value.length>400_000)throw badRequest("Use a PNG or JPEG under 300 KB");
 const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
 if(!match)throw badRequest("Use a PNG or JPEG image");
 const bytes=Buffer.from(match[2],"base64");
 if(bytes.length>300_000||bytes.length<24||bytes.toString("base64")!==match[2])throw badRequest("Invalid image or image exceeds 300 KB");
 const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(match[1]==="png"?!png:!jpeg)throw badRequest("Image content does not match its file type");
 if(png){const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);if(!width||!height||width>4000||height>4000)throw badRequest("Image dimensions must be between 1 and 4000 pixels");}
 return value;
}
