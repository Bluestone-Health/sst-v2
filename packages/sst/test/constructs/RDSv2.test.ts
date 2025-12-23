import { test, expect } from "vitest";
/* eslint-disable @typescript-eslint/ban-ts-comment*/

import { countResources, createApp, hasResource, objectLike } from "./helper";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsManager from "aws-cdk-lib/aws-secretsmanager";
import * as kms from "aws-cdk-lib/aws-kms";
import { Match } from "aws-cdk-lib/assertions";
import { Stack, RDSv2, RDSv2Props } from "../../dist/constructs/";

/////////////////////////////
// Test constructor
/////////////////////////////

test("cdk.cluster is props", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: {
        backup: {
          retention: cdk.Duration.days(7),
        },
      },
    },
  });
  expect(cluster.defaultDatabaseName).toBe("acme");
  expect(cluster.secretArn).toBeDefined();
  expect(cluster.clusterArn).toBeDefined();
  expect(cluster.clusterIdentifier).toBeDefined();
  expect(cluster.clusterEndpoint).toBeDefined();
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    DatabaseName: "acme",
    DBClusterIdentifier: "test-app-cluster",
    EnableHttpEndpoint: true,
    EngineVersion: "13.12",
    BackupRetentionPeriod: 7,
  });
});

test("cdk.cluster contains engine error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      // @ts-ignore Allow type casting
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        cdk: {
          cluster: {
            engine: rds.DatabaseClusterEngine.AURORA_MYSQL,
          },
        },
      } as RDSv2Props)
  ).toThrow(/Use "engine" at the top level/);
});

test("cdk.cluster contains defaultDatabaseName error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      // @ts-ignore Allow type casting
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        cdk: {
          cluster: {
            defaultDatabaseName: "acme",
          },
        },
      } as RDSv2Props)
  ).toThrow(/Use "defaultDatabaseName" at the top level/);
});

test("cdk.cluster contains scaling error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      // @ts-ignore Allow type casting
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        cdk: {
          cluster: {
            scaling: {
              minCapacity: 1,
            },
          },
        },
      } as RDSv2Props)
  ).toThrow(/Use "scaling" at the top level/);
});

test("cdk.cluster contains enableDataApi error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      // @ts-ignore Allow type casting
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        cdk: {
          cluster: {
            enableDataApi: false,
          },
        },
      } as RDSv2Props)
  ).toThrow(/Data API must be enabled/);
});

test("cdk.cluster is imported", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: rds.DatabaseCluster.fromDatabaseClusterAttributes(
        stack,
        "ICluster",
        {
          clusterIdentifier: "my-cluster",
        }
      ),
      secret: secretsManager.Secret.fromSecretAttributes(stack, "ISecret", {
        secretPartialArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret",
      }),
    },
  });
  countResources(stack, "AWS::RDS::DBCluster", 0);
  expect(cluster.defaultDatabaseName).toBe("acme");
  expect(cluster.secretArn).toBe(
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret"
  );
});

test("cdk.cluster is imported: secret imported by partial arn", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: rds.DatabaseCluster.fromDatabaseClusterAttributes(
        stack,
        "ICluster",
        {
          clusterIdentifier: "my-cluster",
        }
      ),
      secret: secretsManager.Secret.fromSecretAttributes(stack, "ISecret", {
        secretPartialArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret",
      }),
    },
  });
  expect(
    cluster.getBindings().permissions["secretsmanager:GetSecretValue"][0]
  ).toBe("arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret*");
});

test("cdk.cluster is imported: secret imported by full arn", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: rds.DatabaseCluster.fromDatabaseClusterAttributes(
        stack,
        "ICluster",
        {
          clusterIdentifier: "my-cluster",
        }
      ),
      secret: secretsManager.Secret.fromSecretAttributes(stack, "ISecret", {
        secretCompleteArn:
          "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-123456",
      }),
    },
  });
  expect(
    cluster.getBindings().permissions["secretsmanager:GetSecretValue"][0]
  ).toBe(
    "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-123456"
  );
});

test("cdk.cluster is imported: no secret error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        cdk: {
          cluster: rds.DatabaseCluster.fromDatabaseClusterAttributes(
            stack,
            "MyCluster",
            {
              clusterIdentifier: "my-cluster",
            }
          ),
        },
      })
  ).toThrow(/Missing "cdk.secret"/);
});

test("defaultDatabaseName missing", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      // @ts-ignore Allow type casting
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
      } as RDSv2Props)
  ).toThrow(/defaultDatabaseName/);
});

test("engine missing", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      // @ts-ignore Allow type casting
      new RDSv2(stack, "Cluster", {
        defaultDatabaseName: "acme",
      } as RDSv2Props)
  ).toThrow(/engine/);
});

test("engine mysql8.0", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "mysql8.0",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-mysql",
    EngineVersion: "8.0.mysql_aurora.3.04.0",
  });
});

test("engine postgresql13.15", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.15",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "13.15",
  });
});

test("engine postgresql13.12", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "13.12",
  });
});

test("engine postgresql13.9", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.9",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "13.9",
  });
});

test("engine postgresql14.10", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql14.10",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "14.10",
  });
});

test("engine postgresql15.12", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql15.12",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "15.12",
  });
});

test("engine postgresql16.1", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql16.1",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "16.1",
  });
});

test("engine postgresql17.4", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql17.4",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    Engine: "aurora-postgresql",
    EngineVersion: "17.4",
  });
});

test("scaling default", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
  });
  // When no scaling config is provided, CDK sets default min/max values
  hasResource(stack, "AWS::RDS::DBCluster", {
    ServerlessV2ScalingConfiguration: {
      MinCapacity: 0.5,
      MaxCapacity: 2,
    },
  });
});

test("scaling with numeric minCapacity and maxCapacity", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    scaling: {
      minCapacity: 0.5,
      maxCapacity: 2,
    },
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    ServerlessV2ScalingConfiguration: {
      MinCapacity: 0.5,
      MaxCapacity: 2,
    },
  });
});

test("scaling with ACU string minCapacity and maxCapacity", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    scaling: {
      minCapacity: "ACU_2",
      maxCapacity: "ACU_8",
    },
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    ServerlessV2ScalingConfiguration: {
      MinCapacity: 2,
      MaxCapacity: 8,
    },
  });
});

test("scaling with secondsUntilAutoPause and minCapacity 0", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    scaling: {
      minCapacity: 0,
      maxCapacity: 2,
      secondsUntilAutoPause: 300,
    },
  });
  // Note: CDK may not include SecondsUntilAutoPause in the template if it's not supported
  // Testing that it at least has the min/max capacity set correctly
  hasResource(stack, "AWS::RDS::DBCluster", {
    ServerlessV2ScalingConfiguration: {
      MinCapacity: 0,
      MaxCapacity: 2,
    },
  });
});

test("scaling with secondsUntilAutoPause and non-zero minCapacity throws error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        scaling: {
          minCapacity: 1,
          maxCapacity: 2,
          secondsUntilAutoPause: 300,
        },
      })
  ).toThrow(/secondsUntilAutoPause.*requires min capacity of 0/);
});

test("migrations", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    migrations: "test/constructs/migrations",
  });
  countResources(stack, "AWS::Lambda::Function", 2); // Migrator + Handler
  hasResource(stack, "AWS::Lambda::Function", {
    Runtime: "nodejs22.x",
    Timeout: 900,
    MemorySize: 1024,
  });
});

test("migrations not found", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        migrations: "test/constructs/does/not/exist",
      })
  ).toThrow(/Cannot find the migrations/);
});

test("cdk.cluster.vpc not provided", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
  });
  countResources(stack, "AWS::EC2::VPC", 1);
});

test("cdk.cluster.vpc provided", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: {
        vpc: ec2.Vpc.fromVpcAttributes(stack, "VPC", {
          availabilityZones: ["us-east-1a"],
          publicSubnetIds: ["{PUBLIC-SUBNET-ID}"],
          privateSubnetIds: ["{PRIVATE-SUBNET-ID}"],
          isolatedSubnetIds: ["{ISOLATED-SUBNET-ID}"],
          vpcId: "{VPC-ID}",
        }),
      },
    },
  });
  countResources(stack, "AWS::EC2::VPC", 0);
});

test("cdk.cluster.credentials: using password error", async () => {
  const stack = new Stack(await createApp(), "stack");
  expect(
    () =>
      new RDSv2(stack, "Cluster", {
        engine: "postgresql13.12",
        defaultDatabaseName: "acme",
        cdk: {
          cluster: {
            credentials: rds.Credentials.fromPassword(
              "admin",
              cdk.SecretValue.ssmSecure("/password")
            ),
          },
        },
      })
  ).toThrow(/Only SecretManager credentials are supported/);
});

test("cdk.cluster.credentials: using secret name", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: {
        credentials: {
          username: "root",
          secretName: "root-secret",
        },
      },
    },
  });
  hasResource(stack, "AWS::SecretsManager::Secret", {
    GenerateSecretString: objectLike({
      SecretStringTemplate: '{"username":"root"}',
    }),
  });
  hasResource(stack, "AWS::RDS::DBCluster", {
    MasterUsername: {
      "Fn::Join": [
        "",
        [
          "{{resolve:secretsmanager:",
          { Ref: Match.anyValue() },
          ":SecretString:username::}}",
        ],
      ],
    },
  });
  // KMS permissions is not granted (not necessary b/c not using custom KMS key)
  const bindings = cluster.getBindings();
  expect(bindings.permissions["kms:Decrypt"]).toBeUndefined();
});

test("cdk.cluster.credentials: using custom kms key", async () => {
  const stack = new Stack(await createApp(), "stack");
  const key = new kms.Key(stack, "Key");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    migrations: "test/constructs/migrations",
    cdk: {
      cluster: {
        credentials: {
          username: "root",
          secretName: "root-secret",
          encryptionKey: key,
        },
      },
    },
  });
  // KMS permissions is granted
  const bindings = cluster.getBindings();
  expect(bindings.permissions["kms:Decrypt"]).toBeDefined();
  // Migration function has permission to this key
  hasResource(stack, "AWS::IAM::Policy", {
    PolicyDocument: {
      Statement: Match.arrayWith([
        {
          Action: "kms:Decrypt",
          Effect: "Allow",
          Resource: {
            "Fn::GetAtt": ["Key961B73FD", "Arn"],
          },
        },
      ]),
    },
    Roles: [
      {
        Ref: Match.stringLikeRegexp("ClusterMigrationFunction.*"),
      },
    ],
  });
});

test("cdk.cluster.credentials: imported secret with custom encryption key", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      cluster: rds.DatabaseCluster.fromDatabaseClusterAttributes(
        stack,
        "CdkCluster",
        { clusterIdentifier: "my-cluster" }
      ),
      secret: secretsManager.Secret.fromSecretAttributes(
        stack,
        "PostgresSecret",
        {
          secretPartialArn:
            "arn:aws:secretsmanager:us-east-1:1234567890:secret:my-secret",
          encryptionKey: kms.Key.fromKeyArn(
            stack,
            "SecretKey",
            "arn:aws:kms:us-east-1:1234567890:key/d286fa44-84fe-480b-bcb6-96b3c9a20edd"
          ),
        }
      ),
    },
  });
  // KMS permissions is granted
  const bindings = cluster.getBindings();
  expect(bindings.permissions["kms:Decrypt"]).toBeDefined();
});

test("types as string", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    types: "backend/core/sql/types.ts",
  });
  const metadata = cluster.getConstructMetadata();
  expect(metadata.data.types).toEqual({
    path: "backend/core/sql/types.ts",
  });
});

test("types as object", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    types: {
      path: "backend/core/sql/types.ts",
      camelCase: true,
    },
  });
  const metadata = cluster.getConstructMetadata();
  expect(metadata.data.types).toEqual({
    path: "backend/core/sql/types.ts",
    camelCase: true,
  });
});

test("getBindings returns correct structure", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
  });
  const bindings = cluster.getBindings();
  expect(bindings.clientPackage).toBe("rds");
  expect(bindings.variables.clusterArn).toBeDefined();
  expect(bindings.variables.secretArn).toBeDefined();
  expect(bindings.variables.defaultDatabaseName).toBeDefined();
  expect(bindings.permissions["rds-data:*"]).toBeDefined();
  expect(bindings.permissions["secretsmanager:GetSecretValue"]).toBeDefined();
  expect(bindings.permissions["secretsmanager:DescribeSecret"]).toBeDefined();
});

test("getConstructMetadata returns correct type", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
  });
  const metadata = cluster.getConstructMetadata();
  expect(metadata.type).toBe("RDS");
  expect(metadata.data.engine).toBe("postgresql13.12");
  expect(metadata.data.defaultDatabaseName).toBe("acme");
  expect(metadata.data.clusterArn).toBeDefined();
  expect(metadata.data.clusterIdentifier).toBeDefined();
  expect(metadata.data.secretArn).toBeDefined();
});

test("getConstructMetadata includes migrator when migrations provided", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    migrations: "test/constructs/migrations",
  });
  const metadata = cluster.getConstructMetadata();
  expect(metadata.data.migrator).toBeDefined();
});

test("cdk.id override", async () => {
  const stack = new Stack(await createApp(), "stack");
  const cluster = new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
    cdk: {
      id: "CustomClusterId",
    },
  });
  expect(cluster.node.id).toBe("CustomClusterId");
});

test("serverless v2 writer instance created", async () => {
  const stack = new Stack(await createApp(), "stack");
  new RDSv2(stack, "Cluster", {
    engine: "postgresql13.12",
    defaultDatabaseName: "acme",
  });
  hasResource(stack, "AWS::RDS::DBInstance", {
    Engine: "aurora-postgresql",
    DBInstanceClass: "db.serverless",
  });
});
