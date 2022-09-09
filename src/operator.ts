import { BUNNY_CDN_EDGE_RULE, BUNNY_CDN_PULL_ZONE, BUNNY_CDN_STORAGE_ZONE, EdgeRule, PullZone, StorageZone } from "./types";
import Operator, { OperatorLogger, ResourceEvent, ResourceEventType } from "@dot-i/k8s-operator";
import { deleteStorageZone, handleStorageZoneModification } from "./manageStorageZone";
import { deletePullZone, handlePullZoneModification } from "./managePullZone";
import { deleteEdgeRule, handleEdgeRuleModification } from "./manageEdgeRule";
import { CustomObjectsApi } from "@kubernetes/client-node";
import { logger } from "./logger";

const BUNNY_CDN_API_KEY = process.env.BUNNY_CDN_API_KEY;

if (!BUNNY_CDN_API_KEY || BUNNY_CDN_API_KEY == "") {
  logger.error("Missing `BUNNY_CDN_API_KEY` environment variable");
  process.exit(9);
}
export const bunnyAPIHeaders = { Accept: "application/json", AccessKey: BUNNY_CDN_API_KEY };

export class BunnyOperator extends Operator {
  customObjectsAPIClient: CustomObjectsApi;
  constructor(logger?: OperatorLogger) {
    super(logger);
    this.customObjectsAPIClient = this.kubeConfig.makeApiClient(CustomObjectsApi);
  }

  protected async init(): Promise<void> {
    // edge rule
    await this.watchResource(BUNNY_CDN_EDGE_RULE.API_GROUP, BUNNY_CDN_EDGE_RULE.API_VERSION, BUNNY_CDN_EDGE_RULE.PLURAL, async e => {
      const object = e.object as EdgeRule;
      const metadata = object.metadata;
      try {
        if (e.type === ResourceEventType.Added || e.type === ResourceEventType.Modified) {
          const isOpDelete = await this.handleResourceFinalizer(e, BUNNY_CDN_EDGE_RULE.API_GROUP, e => this.onEdgeRuleDeleted(e));
          if (!isOpDelete) {
            await this.onEdgeRuleModified(e);
          }
        }
      } catch (err) {
        logger.error(`Failed to process event for resource ${metadata?.name}: ` + (err instanceof Error ? err.message : "error unknown"));
      }
    });

    // storage zone
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

    // pull zone
    await this.watchResource(BUNNY_CDN_PULL_ZONE.API_GROUP, BUNNY_CDN_PULL_ZONE.API_VERSION, BUNNY_CDN_PULL_ZONE.PLURAL, async e => {
      const object = e.object as PullZone;
      const metadata = object.metadata;
      try {
        if (e.type === ResourceEventType.Added || e.type === ResourceEventType.Modified) {
          const isOpDelete = await this.handleResourceFinalizer(e, BUNNY_CDN_PULL_ZONE.API_GROUP, e => this.onPullZoneDeleted(e));
          if (!isOpDelete) {
            await this.onPullZoneModified(e);
          }
        }
      } catch (err) {
        logger.error(`Failed to process event for resource ${metadata?.name}: ` + (err instanceof Error ? err.message : "error unknown"));
      }
    });
  }

  private async onEdgeRuleModified(e: ResourceEvent): Promise<void> {
    const object = e.object as EdgeRule;
    const metadata = object.metadata;

    if (!object.status || object.status.observedGeneration !== metadata.generation) {
      // handle resource modification here
      const { ready, message, id, pullZoneId } = await handleEdgeRuleModification(object, this.customObjectsAPIClient);
      await this.setResourceStatus(e.meta, { observedGeneration: metadata.generation, ready, message, id, pullZoneId });
      logger.debug(`Edge rule ${object.metadata.name} created/updated`);
    }
  }

  private async onEdgeRuleDeleted(e: ResourceEvent): Promise<void> {
    const object = e.object as EdgeRule;

    if (object?.status?.ready) {
      // do delete
      if (!object.status.id || !object.status.pullZoneId) {
        // this shouldn't happen
        throw new Error("Failed to find edge rule ID from resource state");
      }
      if (object.spec.deletionPolicy === "delete") {
        await deleteEdgeRule(object.status.id, object.status.pullZoneId);
      }
    } else {
      // ignore
    }

    logger.debug(`Edge rule ${object.metadata.name} deleted`);
  }

  private async onStorageZoneModified(e: ResourceEvent): Promise<void> {
    const object = e.object as StorageZone;
    const metadata = object.metadata;

    if (!object.status || object.status.observedGeneration !== metadata.generation) {
      // handle resource modification here
      const { ready, message, id } = await handleStorageZoneModification(object, this.k8sApi);

      await this.setResourceStatus(e.meta, { observedGeneration: metadata.generation, ready, message, id });
    }
  }

  private async onStorageZoneDeleted(e: ResourceEvent): Promise<void> {
    const object = e.object as StorageZone;

    if (object?.status?.ready) {
      // do delete
      if (!object.status.id) {
        // this shouldn't happen
        throw new Error("Failed to find storage zone ID from resource state");
      }
      if (object.spec.deletionPolicy === "delete") await deleteStorageZone(object.status.id);
    } else {
      // ignore
    }
    logger.debug("Storage zone deleted");
  }

  private async onPullZoneModified(e: ResourceEvent): Promise<void> {
    const object = e.object as PullZone;
    const metadata = object.metadata;

    if (!object.status || object.status.observedGeneration !== metadata.generation) {
      // handle resource modification here
      const { ready, message, id } = await handlePullZoneModification(object, this.customObjectsAPIClient, this.k8sApi);
      await this.setResourceStatus(e.meta, { observedGeneration: metadata.generation, ready, message, id });
    }
  }

  private async onPullZoneDeleted(e: ResourceEvent): Promise<void> {
    const object = e.object as PullZone;
    if (object?.status?.ready) {
      // do delete
      if (!object.status.id) {
        // this shouldn't happen
        throw new Error("Failed to find pull zone ID from resource state");
      }
      if (object.spec.deletionPolicy === "delete") await deletePullZone(object.status.id);
    } else {
      // ignore
    }
    logger.debug("pull zone deleted");
  }
}
