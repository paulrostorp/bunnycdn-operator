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
### Create a mongoDB tenant / user

Apply `MongoDBUser` custom resource to your cluster:

```yaml
apiVersion: mongotenantoperator.com/v1alpha1
kind: MongoDBUser
metadata:
  name: dev-team-1
  namespace: default
spec:
  dbName: my-awesome-db
  roles:
    - "dbAdmin"
```

This creates a mongodb user as specified and once successful, creates a secret in the same namespace, in the format of `<db name>.<user name>.credentials`.

With the example above, the secret would be named `my-awesome-db.dev-team-1.credentials`.

The secret will contain three keys: `MONGO_DATABASE`, `MONGO_USERNAME` and `MONGO_PASSWORD`.

You can then mount this secret to your workload to connect to the mongo database.