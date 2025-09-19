import { Construct } from "constructs";
import { Token } from "aws-cdk-lib/core";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { TransferDomainProps } from "../Transfer.js";

export interface TransferDomainData {
  readonly domainName: string;
  readonly certificate?: acm.ICertificate;
  readonly hostedZone?: route53.IHostedZone;
  readonly isCertificateCreated: boolean;
  readonly url: string;
}

export function buildTransferDomainData(
  scope: Construct,
  customDomain: string | TransferDomainProps | undefined,
  protocols: ("SFTP" | "FTPS" | "FTP")[] = ["SFTP"]
): TransferDomainData | undefined {
  if (customDomain === undefined) {
    return;
  }
  // customDomain is a string
  else if (typeof customDomain === "string") {
    return buildDataForStringInput(scope, customDomain, protocols);
  }
  // customDomain.domainName is a string
  else if (customDomain.domainName) {
    return customDomain.isExternalDomain
      ? buildDataForExternalDomainInput(scope, customDomain, protocols)
      : buildDataForInternalDomainInput(scope, customDomain, protocols);
  }
  // customDomain.domainName not exists
  throw new Error(
    `Missing "domainName" in Transfer construct's domain setting`
  );
}

function buildDataForStringInput(
  scope: Construct,
  customDomain: string,
  protocols: ("SFTP" | "FTPS" | "FTP")[]
): TransferDomainData {
  // validate: customDomain is a TOKEN string
  // ie. imported SSM value: ssm.StringParameter.valueForStringParameter()
  if (Token.isUnresolved(customDomain)) {
    throw new Error(
      `You also need to specify the "hostedZone" if the "domainName" is passed in as a reference.`
    );
  }

  assertDomainNameIsLowerCase(customDomain);

  const domainName = customDomain;
  const domainParts = domainName.split(".");
  if (domainParts.length > 3) {
    throw new Error(
      `For domains with more than 3 parts, please use the object form and specify the "hostedZone" explicitly to avoid incorrect lookups.`
    );
  }
  const hostedZoneDomain = parseRoute53Domain(domainName);
  const hostedZone = lookupHostedZone(scope, hostedZoneDomain);
  const certificate = protocols.includes("FTPS")
    ? createCertificate(scope, domainName, hostedZone)
    : undefined;

  return {
    domainName,
    certificate,
    hostedZone,
    isCertificateCreated: protocols.includes("FTPS"),
    url: buildDomainUrl(domainName),
  };
}

function buildDataForInternalDomainInput(
  scope: Construct,
  customDomain: TransferDomainProps,
  protocols: ("SFTP" | "FTPS" | "FTP")[]
): TransferDomainData {
  // If customDomain is a TOKEN string, "hostedZone" has to be passed in. This
  // is because "hostedZone" cannot be parsed from a TOKEN value.
  if (Token.isUnresolved(customDomain.domainName)) {
    if (!customDomain.hostedZone && !customDomain.cdk?.hostedZone) {
      throw new Error(
        `You also need to specify the "hostedZone" if the "domainName" is passed in as a reference.`
      );
    }
  }
  // If domain is not a token, ensure it is lower case
  else {
    assertDomainNameIsLowerCase(customDomain.domainName!);
  }
  const domainName = customDomain.domainName!;

  // Lookup hosted zone
  // Note: Allow user passing in `hostedZone` object. The use case is when
  //       there are multiple HostedZones with the same domain, but one is
  //       public, and one is private.
  let hostedZone: route53.IHostedZone;
  if (customDomain.hostedZone) {
    const hostedZoneDomain = customDomain.hostedZone;
    hostedZone = lookupHostedZone(scope, hostedZoneDomain);
  } else if (customDomain.cdk?.hostedZone) {
    hostedZone = customDomain.cdk.hostedZone;
  } else {
    const hostedZoneDomain = parseRoute53Domain(domainName);
    hostedZone = lookupHostedZone(scope, hostedZoneDomain);
  }

  // Create certificate
  // Note: Allow user passing in `certificate` object. The use case is for
  //       user to create wildcard certificate or using an imported certificate.
  let certificate: acm.ICertificate | undefined;
  let isCertificateCreated: boolean;
  if (customDomain.cdk?.certificate) {
    certificate = customDomain.cdk.certificate;
    isCertificateCreated = false;
  } else if (protocols.includes("FTPS")) {
    certificate = createCertificate(scope, domainName, hostedZone);
    isCertificateCreated = true;
  } else {
    certificate = undefined;
    isCertificateCreated = false;
  }

  return {
    domainName,
    certificate,
    hostedZone,
    isCertificateCreated,
    url: buildDomainUrl(domainName),
  };
}

function buildDataForExternalDomainInput(
  scope: Construct,
  customDomain: TransferDomainProps,
  protocols: ("SFTP" | "FTPS" | "FTP")[]
): TransferDomainData {
  const domainName = customDomain.domainName!;

  // If domain is not a token, ensure it is lower case
  if (!Token.isUnresolved(domainName)) {
    assertDomainNameIsLowerCase(domainName);
  }

  // Create certificate (required even for external domains if we want TLS)
  let certificate: acm.ICertificate | undefined;
  let isCertificateCreated: boolean;
  if (customDomain.cdk?.certificate) {
    certificate = customDomain.cdk.certificate;
    isCertificateCreated = false;
  } else {
    // For external domains, user needs to provide certificate
    certificate = undefined;
    isCertificateCreated = false;
  }

  return {
    domainName,
    certificate,
    hostedZone: undefined,
    isCertificateCreated,
    url: buildDomainUrl(domainName),
  };
}

function parseRoute53Domain(domainName: string): string {
  const domainParts = domainName.split(".");
  if (domainParts.length < 2) {
    throw new Error(`Invalid domain name: ${domainName}`);
  }

  // For subdomain like sftp.example.com, return example.com
  // For apex domain like example.com, return example.com
  return domainParts.length === 2
    ? domainName
    : domainParts.slice(-2).join(".");
}

function lookupHostedZone(
  scope: Construct,
  hostedZoneDomain: string
): route53.IHostedZone {
  return route53.HostedZone.fromLookup(scope, "HostedZone", {
    domainName: hostedZoneDomain,
  });
}

function createCertificate(
  scope: Construct,
  domainName: string,
  hostedZone: route53.IHostedZone
): acm.Certificate {
  return new acm.Certificate(scope, "Certificate", {
    domainName,
    validation: acm.CertificateValidation.fromDns(hostedZone),
  });
}

function buildDomainUrl(domainName: string): string {
  return `sftp://${domainName}`;
}

function assertDomainNameIsLowerCase(domainName: string): void {
  if (domainName !== domainName.toLowerCase()) {
    throw new Error(
      `Domain name "${domainName}" must be lowercase. Use "${domainName.toLowerCase()}" instead.`
    );
  }
}

export function createCNAMERecord(
  scope: Construct,
  hostedZone: route53.IHostedZone,
  domainName: string,
  targetDomainName: string
): route53.CnameRecord {
  return new route53.CnameRecord(scope, "CnameRecord", {
    zone: hostedZone,
    recordName: domainName,
    domainName: targetDomainName,
  });
}
