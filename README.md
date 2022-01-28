# bunnycdn-operator

This operator helps you dynamically create mongo db users, their roles, and DB associations.
A typical use would be in a system where multiple "tenants" share a single mongoDB cluster, such a cluster with multiple namespaces, each corresponding to a development environment (or pr-branch environment).

### Install Custom Resource Definitions
```sh
kubectl apply -f ./manifests/crds/
```

### Install the operator

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb-tenant-operator
  namespace: default
  labels:
    app: mongodb-tenant-operator
spec:
  selector:
    matchLabels:
      app: mongodb-tenant-operator
  replicas: 1
  template:
    metadata:
      labels:
        app: mongodb-tenant-operator
    spec:
      containers:
      - name:  mongodb-tenant-operator
        image: ghcr.io/paulrostorp/bunnycdn-operator:latest
        resources:
          requests:
            cpu: 50m
            memory: 100Mi
          limits:
            cpu: 100m
            memory: 150Mi
        env:
        - name: MONGO_CLUSTER_ADMIN_URI
          valueFrom:
            secretKeyRef: ### -> Replace this with your own creds
              name: mongodb-admin-credentials
              key: MONGO_DB_HOST 
      restartPolicy: Always
```
If your cluster has RBAC enabled, see the detailed example in the `/manifests` directory.
### Creating a storage zone

Apply `StorageZone` custom resource to your cluster:

```yaml
apiVersion: bunny-cdn-operator.com/v1alpha1
kind: StorageZone
metadata:
  name: operator-test-xyz-test-zone
  namespace: default
spec:
  region: DE
  replicationRegions: ["NY", "LA"]
```

This creates a storage zone on your bunny CDN account. Keep in mind that `name` is globally unique and at this time you cannot edit a storage zone once created.