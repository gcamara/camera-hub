import {
  isAuthFault,
  parseDeviceInformation,
  parseMediaXAddr,
  parseProfiles,
  parseSoapFault,
  parseStreamUri,
  parseSystemDateAndTime,
  pickDefaultProfiles,
} from '../parse';

const envelope = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema"><SOAP-ENV:Header/><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

describe('parseSystemDateAndTime', () => {
  it('reads the UTC clock', () => {
    const xml = envelope(
      '<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:DateTimeType>NTP</tt:DateTimeType><tt:UTCDateTime><tt:Time><tt:Hour>8</tt:Hour><tt:Minute>5</tt:Minute><tt:Second>9</tt:Second></tt:Time><tt:Date><tt:Year>2026</tt:Year><tt:Month>9</tt:Month><tt:Day>17</tt:Day></tt:Date></tt:UTCDateTime></tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>',
    );
    expect(parseSystemDateAndTime(xml)?.toISOString()).toBe('2026-09-17T08:05:09.000Z');
  });

  it('returns null when the clock is missing', () => {
    expect(parseSystemDateAndTime(envelope('<tds:GetSystemDateAndTimeResponse/>'))).toBeNull();
  });
});

describe('parseDeviceInformation', () => {
  it('extracts the identity fields', () => {
    const xml = envelope(
      '<tds:GetDeviceInformationResponse><tds:Manufacturer>Reolink</tds:Manufacturer><tds:Model>RLC-810A</tds:Model><tds:FirmwareVersion>v3.1.0.2368</tds:FirmwareVersion><tds:SerialNumber>00000000</tds:SerialNumber><tds:HardwareId>IPC</tds:HardwareId></tds:GetDeviceInformationResponse>',
    );
    expect(parseDeviceInformation(xml)).toEqual({
      manufacturer: 'Reolink',
      model: 'RLC-810A',
      firmwareVersion: 'v3.1.0.2368',
      serialNumber: '00000000',
    });
  });
});

describe('parseMediaXAddr', () => {
  it('finds the media service address in GetCapabilities', () => {
    const xml = envelope(
      '<tds:GetCapabilitiesResponse><tds:Capabilities><tt:Device><tt:XAddr>http://192.168.1.23:8000/onvif/device_service</tt:XAddr></tt:Device><tt:Media><tt:XAddr>http://192.168.1.23:8000/onvif/media_service</tt:XAddr><tt:StreamingCapabilities><tt:RTPMulticast>false</tt:RTPMulticast></tt:StreamingCapabilities></tt:Media></tds:Capabilities></tds:GetCapabilitiesResponse>',
    );
    expect(parseMediaXAddr(xml)).toBe('http://192.168.1.23:8000/onvif/media_service');
  });
});

describe('parseProfiles', () => {
  const xml = envelope(
    '<trt:GetProfilesResponse>' +
      '<trt:Profiles token="000" fixed="true"><tt:Name>mainStream</tt:Name><tt:VideoEncoderConfiguration token="000"><tt:Name>VideoEncoder_1</tt:Name><tt:Encoding>H265</tt:Encoding><tt:Resolution><tt:Width>2560</tt:Width><tt:Height>1440</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>' +
      '<trt:Profiles token="001" fixed="true"><tt:Name>subStream</tt:Name><tt:VideoEncoderConfiguration token="001"><tt:Name>VideoEncoder_2</tt:Name><tt:Encoding>H264</tt:Encoding><tt:Resolution><tt:Width>640</tt:Width><tt:Height>360</tt:Height></tt:Resolution></tt:VideoEncoderConfiguration></trt:Profiles>' +
      '<trt:Profiles token="002"><tt:Name>audioOnly</tt:Name></trt:Profiles>' +
      '</trt:GetProfilesResponse>',
  );

  it('keeps tokens as strings and reads encoder details', () => {
    expect(parseProfiles(xml)).toEqual([
      { token: '000', name: 'mainStream', encoding: 'H265', width: 2560, height: 1440 },
      { token: '001', name: 'subStream', encoding: 'H264', width: 640, height: 360 },
      { token: '002', name: 'audioOnly', encoding: undefined, width: undefined, height: undefined },
    ]);
  });

  it('handles a single profile that is not wrapped in an array', () => {
    const single = envelope('<trt:GetProfilesResponse><trt:Profiles token="p1"><tt:Name>only</tt:Name></trt:Profiles></trt:GetProfilesResponse>');
    expect(parseProfiles(single)).toHaveLength(1);
  });

  it('picks the largest profile as main and the smallest as sub', () => {
    const picked = pickDefaultProfiles(parseProfiles(xml));
    expect(picked.main?.token).toBe('000');
    expect(picked.sub?.token).toBe('002');
    expect(pickDefaultProfiles([{ token: 'a', name: 'a' }])).toEqual({ main: { token: 'a', name: 'a' }, sub: undefined });
    expect(pickDefaultProfiles([])).toEqual({});
  });
});

describe('parseStreamUri', () => {
  it('returns the RTSP URI', () => {
    const xml = envelope(
      '<trt:GetStreamUriResponse><trt:MediaUri><tt:Uri>rtsp://192.168.1.23:554/h264Preview_01_main</tt:Uri><tt:InvalidAfterConnect>false</tt:InvalidAfterConnect><tt:InvalidAfterReboot>false</tt:InvalidAfterReboot><tt:Timeout>PT0S</tt:Timeout></trt:MediaUri></trt:GetStreamUriResponse>',
    );
    expect(parseStreamUri(xml)).toBe('rtsp://192.168.1.23:554/h264Preview_01_main');
  });
});

describe('parseSoapFault', () => {
  it('reads the reason text of a SOAP 1.2 fault', () => {
    const xml = envelope(
      '<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value><SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code><SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Sender not authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>',
    );
    expect(parseSoapFault(xml)).toEqual({ reason: 'Sender not authorized', subcode: 'ter:NotAuthorized' });
    expect(isAuthFault(parseSoapFault(xml)!)).toBe(true);
    expect(isAuthFault({ reason: 'Profile does not exist', subcode: 'ter:NoProfile' })).toBe(false);
    expect(parseSoapFault(envelope('<tds:GetDeviceInformationResponse/>'))).toBeNull();
  });
});
