# bunnycdn-operator

This kubernetes operator helps you dynamically create pull zones and storage zones on [BunnyCDN](https://bunny.net/).

### Install Custom Resource Definitions
```sh
kubectl apply -f ./manifests/crds/
```

### Install the operator

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: bunny-cdn-operator
  namespace: default
  labels:
    app: bunny-cdn-operator
spec:
  selector:
    matchLabels:
      app: bunny-cdn-operator
  replicas: 1
  template:
    metadata:
      labels:
        app: bunny-cdn-operator
    spec:
      containers:
      - name:  bunny-cdn-operator
        image: ghcr.io/paulrostorp/bunnycdn-operator:latest
        resources:
          requests:
            cpu: 50m
            memory: 100Mi
          limits:
            cpu: 100m
            memory: 150Mi
        env:
        - name: BUNNY_CDN_API_KEY
          valueFrom:
            secretKeyRef: ### -> Replace this with your own creds
              name: bunny-cdn-credentials
              key: API_KEY
      restartPolicy: Always
```
If your cluster has RBAC enabled, see the detailed example in the `/manifests` directory.
### Creating a storage zone

Apply `StorageZone` custom resource to your cluster:

```yaml
apiVersion: bunny-cdn-operator.com/v1alpha1
kind: StorageZone
metadata:
  name: operator-test-xyz-test-storage-zone
  namespace: default
spec:
  region: DE
  replicationRegions: ["NY", "LA"]
  deletionPolicy: retain # whether the resource should be deleted in bunny cdn when it is deleted in k8s. Possible values are "delete" or "retain"
```

This creates a storage zone on your bunny CDN account. Keep in mind that `name` is globally unique and at this time you cannot edit a storage zone once created.
It will also produce a k8s secret named `<name of storage zone>.storagezone.credentials` containing the required credentials to upload/download content.
### Creating a pull zone

Apply `PullZone` custom resource to your cluster:

```yaml
apiVersion: bunny-cdn-operator.com/v1alpha1
kind: PullZone
metadata:
  name: operator-test-xyz-test-pull-zone
  namespace: default
spec:
  storageZoneRef:
    name: operator-test-xyz-test-storage-zone
    namespace: default
  zoneType: volume
  monthlyBandwidthLimit: 10000
  deletionPolicy: retain # whether the resource should be deleted in bunny cdn when it is deleted in k8s. Possible values are "delete" or "retain"
```

This creates a pull zone on your bunny CDN account. Keep in mind that `name` is globally unique and at this time you cannot edit a storage zone once created.
It will also produce a k8s secret named `<name of pull zone>.pullzone.credentials` containing information and credentials about the pull zone.

### Creating an edge rule

Apply `EdgeRule` custom resource to your cluster:
Configuration guidelines are documented here: https://docs.bunny.net/reference/pullzonepublic_addedgerule


```yaml
apiVersion: bunny-cdn-operator.com/v1alpha1
kind: EdgeRule
metadata:
  name: operator-test-xyz-test-pull-zone
  namespace: default
spec:
  pullZoneRef:
    name: testing-pz
    namespace: default
  actionType: 1
  actionParameter1: yahoo.fr
  triggers:
    - type: 0
      patternMatches: ["*"]
      patternMatchingType: 0
  triggerMatchingType: 0
  description: testing operator rule
  enabled: true
  deletionPolicy: delete
  
```

