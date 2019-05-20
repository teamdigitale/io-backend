import { errorsToReadableMessages } from "italia-ts-commons/lib/reporters";
import nodeFetch from "node-fetch";
import { DOMParser } from "xmldom";
import { IDPEntityDescriptor } from "../types/IDPEntityDescriptor";
import { log } from "./logger";

const EntityDescriptorTAG = "md:EntityDescriptor";
const X509CertificateTAG = "ds:X509Certificate";
const SingleSignOnServiceTAG = "md:SingleSignOnService";
const SingleLogoutServiceTAG = "md:SingleLogoutService";

/**
 * Parse a string that represents an XML file containing the ipd Metadata and converts it into an array of IDPEntityDescriptor
 * Required namespace definitions into the XML are xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" and xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
 * An example file is provided in /test_idps/spid-entities-idps.xml of this project.
 */
export function parseIdpMetadata(
  ipdMetadataPage: string
): ReadonlyArray<IDPEntityDescriptor> {
  const domParser = new DOMParser().parseFromString(ipdMetadataPage);
  const entityDescriptors = domParser.getElementsByTagName(EntityDescriptorTAG);
  return Array.from(entityDescriptors).reduce(
    (idps: ReadonlyArray<IDPEntityDescriptor>, element: Element) => {
      const certs = Array.from(
        element.getElementsByTagName(X509CertificateTAG)
      ).map(_ => {
        if (_.textContent) {
          return _.textContent.replace(/[\n\s]/g, "");
        }
        return "";
      });
      const elementInfoOrErrors = IDPEntityDescriptor.decode({
        cert: certs,
        entityID: element.getAttribute("entityID"),
        entryPoint: (element
          .getElementsByTagName(SingleSignOnServiceTAG)
          .item(0) as Element).getAttribute("Location"),
        logoutUrl: (element
          .getElementsByTagName(SingleLogoutServiceTAG)
          .item(0) as Element).getAttribute("Location")
      });
      if (elementInfoOrErrors.isLeft()) {
        log.warn(
          "Invalid md:EntityDescriptor. %s",
          errorsToReadableMessages(elementInfoOrErrors.value).join(" / ")
        );
        return idps;
      }
      return [...idps, elementInfoOrErrors.value];
    },
    []
  );
}

/**
 * Fetch an ipds Metadata XML file from a remote url and convert it into a string
 */
export async function fetchIdpMetadata(
  idpMetadataUrl: string
): Promise<string> {
  const idpMetadataRequest = await nodeFetch(idpMetadataUrl);
  return await idpMetadataRequest.text();
}

/**
 * Map provided idpMetadata in an object with idp key whitelisted in ipdIds.
 * Mapping is based on entityID property
 */
export const mapIpdMetadata = (
  idpMetadata: ReadonlyArray<IDPEntityDescriptor>,
  idpIds: { [key: string]: string | undefined }
) =>
  idpMetadata.reduce(
    (prev, idp) => {
      const idpKey = idpIds[idp.entityID];
      if (idpKey) {
        return { ...prev, [idpKey]: idp };
      }
      log.warn(
        `Unsupported SPID idp from metadata repository [${idp.entityID}]`
      );
      return prev;
    },
    {} as { [key: string]: IDPEntityDescriptor | undefined }
  );
