import { CoreV1Api, KubernetesObject, V1OwnerReference, V1Secret } from "@kubernetes/client-node";
import { isNestedHttpResponse } from "./misc";
import { logger } from "../logger";

export const getSecret = async (k8sApiClient: CoreV1Api, secretName: string, namespace: string): Promise<V1Secret | undefined> => {
  try {
    const { body } = await k8sApiClient.readNamespacedSecret(secretName, namespace);
    return body;
  } catch (e) {
    if (isNestedHttpResponse(e)) {
      if (e.response.statusCode == 404) {
        logger.debug(`Secret ${secretName} not found.`);
        return undefined;
      }
    }
    throw e;
  }
};

export const createK8Secret = async (
  k8sApiClient: CoreV1Api,
  secretName: string,
  secretData: { [key: string]: string },
  namespace: string,
  ownerRef?: KubernetesObject
): Promise<void> => {
  try {
    await k8sApiClient.readNamespace(namespace); // call this to ensure namespace exists

    const existingSecret = await getSecret(k8sApiClient, secretName, namespace);

    if (existingSecret) {
      logger.debug(`Secret ${secretName} already exists, delete it...`);
      await k8sApiClient.deleteNamespacedSecret(secretName, namespace);
    }
    logger.debug(`Creating secret ${secretName}...`);

    const ownerReferences: V1OwnerReference[] = [];
    if (ownerRef && ownerRef.apiVersion && ownerRef.kind && ownerRef.metadata?.name && ownerRef.metadata.uid) {
      ownerReferences.push({
        apiVersion: ownerRef.apiVersion,
        kind: ownerRef.kind,
        name: ownerRef.metadata?.name,
        uid: ownerRef.metadata.uid,
      });
    }

    await k8sApiClient.createNamespacedSecret(namespace, {
      metadata: {
        name: secretName,

        ownerReferences: ownerReferences,
      },
      data: secretData,
    });
    logger.debug(`Successfully created secret ${secretName}.`);
  } catch (e) {
    if (isNestedHttpResponse(e)) {
      throw new Error(
        `Error occurred when attempting to create secret "${secretName}" in namespace: "${namespace}" (${e.response.statusCode}) : ${e.response.statusMessage}`
      );
    }
    throw new Error("Unknown error");
  }
};
