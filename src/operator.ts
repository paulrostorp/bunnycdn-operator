import Operator, { ResourceEvent, ResourceEventType } from "@dot-i/k8s-operator";
// import { createUser, deleteUser } from "./manageUsers";
import { logger } from "./logger";
import { BUNNY_CDN_STORAGE_ZONE, StorageZone } from "./PullZone";
// import { MongoDBUser, MONGO_DB_USER } from "./MongoDBUser";

const BUNNY_CDN_API_KEY = process.env.BUNNY_CDN_API_KEY;

if (!BUNNY_CDN_API_KEY || BUNNY_CDN_API_KEY == "") {
  logger.error("Missing `BUNNY_CDN_API_KEY` environment variable");
  process.exit(9);
}
export const bunnyAPIHeaders = { Accept: "application/json", AccessKey: BUNNY_CDN_API_KEY };

export class BunnyOperator extends Operator {
  protected async init(): Promise<void> {
    await this.watchResource(
      BUNNY_CDN_STORAGE_ZONE.API_GROUP,
      BUNNY_CDN_STORAGE_ZONE.API_VERSION,
      BUNNY_CDN_STORAGE_ZONE.PLURAL,
      async e => {
        const object = e.object as StorageZone;
        const metadata = object.metadata;
        try {
          if (e.type === ResourceEventType.Added || e.type === ResourceEventType.Modified) {
            const isOpDelete = await this.handleResourceFinalizer(e, BUNNY_CDN_STORAGE_ZONE.API_GROUP, e => this.onStorageZoneDeleted(e));
            if (!isOpDelete) {
              await this.onStorageZoneModified(e);
            }
          }
        } catch (err) {
          logger.error(`Failed to process event for resource ${metadata?.name}: ` + (err instanceof Error ? err.message : "error unknown"));
        }
      }
    );
  }

  private async onStorageZoneModified(e: ResourceEvent): Promise<void> {
    const object = e.object as StorageZone;
    const metadata = object.metadata;

    if (!object.status || object.status.observedGeneration !== metadata.generation) {
      // handle resource modification here

      // await createUser({ mongoClient: this.mongoClient, k8sClient: this.k8sApi, object });

      await this.setResourceStatus(e.meta, { observedGeneration: metadata.generation });
    }
  }

  private async onStorageZoneDeleted(e: ResourceEvent): Promise<void> {
    logger.debug("Storage zone deleted");
    // const object = e.object as MongoDBUser;

    // await deleteUser({ mongoClient: this.mongoClient, object });
  }
}
