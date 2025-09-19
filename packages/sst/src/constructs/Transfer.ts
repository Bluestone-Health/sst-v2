import { Construct } from "constructs";
import { RemovalPolicy } from "aws-cdk-lib/core";
import {
  CfnServer,
  CfnServerProps,
  CfnUser,
  CfnUserProps,
} from "aws-cdk-lib/aws-transfer";
import {
  IBucket,
  Bucket as CDKBucket,
  BucketProps as CDKBucketProps,
} from "aws-cdk-lib/aws-s3";
import {
  IVpc,
  ISecurityGroup,
  SecurityGroup,
  Port,
  Peer,
} from "aws-cdk-lib/aws-ec2";
import {
  Role,
  ServicePrincipal,
  PolicyDocument,
  PolicyStatement,
  IRole,
  ManagedPolicy,
} from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as logs from "aws-cdk-lib/aws-logs";

import { App } from "./App.js";
import { Stack } from "./Stack.js";
import { SSTConstruct } from "./Construct.js";
import { BindingResource, BindingProps } from "./util/binding.js";
import { Permissions } from "./util/permission.js";
import * as transferDomain from "./util/transferDomain.js";

/////////////////////
// Interfaces
/////////////////////

export interface TransferDomainProps {
  /**
   * The domain to be assigned to the SFTP endpoint (e.g., sftp.domain.com)
   */
  domainName?: string;
  /**
   * The hosted zone in Route 53 that contains the domain. By default, SST will look for a hosted zone by stripping out the first part of the domainName that's passed in. So, if your domainName is sftp.domain.com, SST will default the hostedZone to domain.com.
   */
  hostedZone?: string;
  /**
   * Set this option if the domain is not hosted on Amazon Route 53.
   */
  isExternalDomain?: boolean;
  cdk?: {
    /**
     * Override the internally created hosted zone
     */
    hostedZone?: route53.IHostedZone;
    /**
     * Override the internally created certificate
     */
    certificate?: acm.ICertificate;
  };
}

export interface TransferUserProps {
  /**
   * IAM role that determines the user's access permissions for your Amazon S3 bucket or EFS file system.
   */
  role: IRole | string;
  /**
   * The landing directory (folder) for a user when they log in to the server using the client.
   */
  homeDirectory?: string;
  /**
   * The type of landing directory (folder) you want your users' home directory to be when they log in to the SFTP server.
   * @default "PATH"
   */
  homeDirectoryType?: "PATH" | "LOGICAL";
  /**
   * SSH public keys associated with the user account.
   */
  sshPublicKeys?: string[];
  /**
   * Specifies the full POSIX identity, including user ID (Uid), group ID (Gid), and any secondary groups IDs (SecondaryGids), that controls your users' access to your Amazon EFS file systems.
   */
  posixProfile?: {
    uid: number;
    gid: number;
    secondaryGids?: number[];
  };
  /**
   * A session policy for your user so that you can use the same IAM role across multiple users. This policy restricts user access to portions of their Amazon S3 bucket.
   */
  policy?: string;
  /**
   * Specifies the Amazon Resource Names (ARNs) of the AWS Identity and Access Management (IAM) groups that you want to associate with the user account.
   */
  tags?: Record<string, string>;
}

export interface TransferProps {
  /**
   * Custom domain configuration for the SFTP endpoint.
   *
   * @example
   * ```js
   * new Transfer(stack, "Transfer", {
   *   domain: "sftp.example.com"
   * });
   * ```
   *
   * @example
   * ```js
   * new Transfer(stack, "Transfer", {
   *   domain: {
   *     domainName: "sftp.example.com",
   *     hostedZone: "example.com"
   *   }
   * });
   * ```
   */
  domain?: string | TransferDomainProps;

  /**
   * Protocols supported by the server.
   * @default ["SFTP"]
   */
  protocols?: ("SFTP" | "FTPS" | "FTP")[];

  /**
   * Identity provider type.
   * @default "SERVICE_MANAGED"
   */
  identityProviderType?:
    | "SERVICE_MANAGED"
    | "API_GATEWAY"
    | "AWS_DIRECTORY_SERVICE";

  /**
   * Users to create on the server.
   *
   * @example
   * ```js
   * new Transfer(stack, "Transfer", {
   *   users: {
   *     "avantek": {
   *       role: "arn:aws:iam::account:role/SftpUserRole",
   *       sshPublicKeys: ["ssh-rsa AAAAB3..."]
   *     }
   *   }
   * });
   * ```
   */
  users?: Record<string, TransferUserProps>;

  /**
   * S3 bucket for file storage. If not provided, a new bucket will be created.
   */
  bucket?: IBucket | string;

  /**
   * Endpoint type configuration.
   * @default "PUBLIC"
   */
  endpointType?: "PUBLIC" | "VPC";

  /**
   * VPC configuration for VPC endpoints. Required when endpointType is "VPC".
   */
  vpc?: IVpc;

  /**
   * Security groups for VPC endpoints. If not provided, a default security group will be created.
   */
  securityGroups?: ISecurityGroup[];

  /**
   * Enable CloudWatch logging.
   * @default true
   */
  logging?: boolean;

  /**
   * IAM role for CloudWatch logging. If not provided, a role will be created automatically.
   */
  loggingRole?: IRole;

  /**
   * Security policy for cryptographic algorithms.
   * @default "TransferSecurityPolicy-2020-06"
   */
  securityPolicyName?: string;

  cdk?: {
    /**
     * Allows you to override default id for this construct.
     */
    id?: string;
    /**
     * Override the internally created Transfer server.
     *
     * @example
     * ```js
     * new Transfer(stack, "Transfer", {
     *   cdk: {
     *     server: {
     *       loggingRole: existingRole.roleArn,
     *     }
     *   },
     * });
     * ```
     */
    server?: CfnServer | CfnServerProps;
    /**
     * Override the internally created S3 bucket.
     */
    bucket?: IBucket | CDKBucketProps;
  };
}

/////////////////////
// Construct
/////////////////////

/**
 * The `Transfer` construct is a higher level CDK construct that makes it easy to create an AWS Transfer Family server for SFTP, FTPS, and FTP file transfers.
 *
 * @example
 *
 * ```js
 * import { Transfer } from "sst/constructs";
 *
 * new Transfer(stack, "Transfer", {
 *   domain: "sftp.example.com",
 *   users: {
 *     "avantek": {
 *       role: "arn:aws:iam::account:role/SftpUserRole",
 *       sshPublicKeys: ["ssh-rsa AAAAB3..."]
 *     }
 *   }
 * });
 * ```
 */
export class Transfer extends Construct implements SSTConstruct {
  public readonly id: string;
  public readonly cdk: {
    /**
     * The internally created CDK Transfer server instance.
     */
    server: CfnServer;
    /**
     * The internally created or referenced S3 bucket.
     */
    bucket?: IBucket;
    /**
     * If custom domain is enabled, this is the internally created Route53 record.
     */
    domainRecord?: route53.ARecord;
    /**
     * If custom domain is enabled, this is the internally created Certificate.
     */
    certificate?: acm.Certificate;
    /**
     * The internally created CloudWatch log group.
     */
    logGroup?: logs.LogGroup;
    /**
     * The internally created logging role.
     */
    loggingRole?: IRole;
  };

  private props: TransferProps;
  private _customDomainUrl?: string;
  private users: Record<string, CfnUser> = {};

  constructor(scope: Construct, id: string, props: TransferProps = {}) {
    super(scope, props.cdk?.id || id);

    this.id = id;
    this.props = props;
    this.cdk = {} as any;

    this.validateProps();
    this.createBucket();
    this.createLoggingResources();
    this.createServer();
    this.createUsers();
    this.setupCustomDomain();

    const app = this.node.root as App;
    app.registerTypes(this);
  }

  /**
   * The ARN of the Transfer server.
   */
  public get serverArn(): string {
    return this.cdk.server.attrArn;
  }

  /**
   * The server ID of the Transfer server.
   */
  public get serverId(): string {
    return this.cdk.server.attrServerId;
  }

  /**
   * The endpoint of the Transfer server.
   */
  public get endpoint(): string {
    return this.cdk.server.attrEndpoint;
  }

  /**
   * If custom domain is enabled, this is the custom domain URL of the Transfer server.
   */
  public get customDomainUrl(): string | undefined {
    return this._customDomainUrl;
  }

  /**
   * The name of the S3 bucket used for file storage.
   */
  public get bucketName(): string | undefined {
    return this.cdk.bucket?.bucketName;
  }

  /**
   * The ARN of the S3 bucket used for file storage.
   */
  public get bucketArn(): string | undefined {
    return this.cdk.bucket?.bucketArn;
  }

  /**
   * Add a user to the Transfer server after it has been created.
   *
   * @example
   * ```js
   * const transfer = new Transfer(stack, "Transfer");
   * transfer.addUser("newuser", {
   *   role: userRole,
   *   sshPublicKeys: ["ssh-rsa AAAAB3..."]
   * });
   * ```
   */
  public addUser(username: string, props: TransferUserProps): void {
    this.createUser(username, props);
  }

  /**
   * Remove a user from the Transfer server.
   *
   * @example
   * ```js
   * transfer.removeUser("olduser");
   * ```
   */
  public removeUser(username: string): void {
    const user = this.users[username];
    if (user) {
      this.node.tryRemoveChild(user.node.id);
      delete this.users[username];
    }
  }

  /**
   * Binds the given list of resources to all users.
   *
   * @example
   * ```js
   * transfer.bind([STRIPE_KEY, bucket]);
   * ```
   */
  public bind(constructs: BindingResource[]): void {
    // Transfer doesn't have functions to bind to, but this method is included for consistency
    // In the future, this could be used for custom authorizer functions
  }

  /**
   * Attaches the given list of permissions to the Transfer server's logging role.
   *
   * @example
   * ```js
   * transfer.attachPermissions(["logs:CreateLogGroup"]);
   * ```
   */
  public attachPermissions(permissions: Permissions): void {
    if (this.cdk.loggingRole && "attachInlinePolicy" in this.cdk.loggingRole) {
      // Implementation would go here for attaching additional permissions
    }
  }

  public getConstructMetadata() {
    return {
      type: "Transfer" as const,
      data: {
        serverId: this.serverId,
        serverArn: this.serverArn,
        endpoint: this.endpoint,
        customDomainUrl: this.customDomainUrl,
        bucketName: this.bucketName,
        bucketArn: this.bucketArn,
        protocols: this.props.protocols || ["SFTP"],
        endpointType: this.props.endpointType || "PUBLIC",
        users: Object.keys(this.users),
      },
    };
  }

  /** @internal */
  public getBindings(): BindingProps {
    const bindings: BindingProps = {
      clientPackage: "transfer",
      variables: {
        serverId: {
          type: "plain",
          value: this.serverId,
        },
        endpoint: {
          type: "plain",
          value: this.endpoint,
        },
      },
      permissions: {},
    };

    if (this.customDomainUrl) {
      bindings.variables!.customDomainUrl = {
        type: "plain",
        value: this.customDomainUrl,
      };
    }

    if (this.bucketName && this.bucketArn) {
      bindings.variables!.bucketName = {
        type: "plain",
        value: this.bucketName,
      };
      bindings.permissions!["s3:*"] = [this.bucketArn, `${this.bucketArn}/*`];
    }

    return bindings;
  }

  private validateProps(): void {
    const { endpointType, vpc } = this.props;

    if (endpointType === "VPC" && !vpc) {
      throw new Error(
        `Missing "vpc" property when "endpointType" is set to "VPC" in the "${this.node.id}" Transfer`
      );
    }
  }

  private createBucket(): void {
    const { bucket, cdk } = this.props;

    if (typeof bucket === "string") {
      // Reference existing bucket by name/ARN
      this.cdk.bucket = CDKBucket.fromBucketName(this, "Bucket", bucket);
    } else if (bucket) {
      // Use provided bucket construct
      this.cdk.bucket = bucket;
    } else if (
      cdk?.bucket &&
      typeof (cdk.bucket as IBucket).applyRemovalPolicy === "function"
    ) {
      // Use provided bucket construct from CDK override
      this.cdk.bucket = cdk.bucket as IBucket;
    } else if (cdk?.bucket) {
      // Create new bucket with CDK props
      this.cdk.bucket = new CDKBucket(this, "Bucket", {
        removalPolicy: RemovalPolicy.RETAIN,
        ...cdk.bucket,
      });
    } else {
      // Create default bucket
      const app = this.node.root as App;
      this.cdk.bucket = new CDKBucket(this, "Bucket", {
        bucketName: app.logicalPrefixedName(this.node.id).toLowerCase(),
        removalPolicy: RemovalPolicy.RETAIN,
      });
    }
  }

  private createLoggingResources(): void {
    const { logging = true, loggingRole } = this.props;

    if (!logging) {
      return;
    }

    // Create log group
    this.cdk.logGroup = new logs.LogGroup(this, "LogGroup", {
      retention: logs.RetentionDays.ONE_MONTH,
    });

    // Create or use provided logging role
    if (loggingRole) {
      this.cdk.loggingRole = loggingRole;
    } else {
      this.cdk.loggingRole = new Role(this, "LoggingRole", {
        assumedBy: new ServicePrincipal("transfer.amazonaws.com"),
        inlinePolicies: {
          TransferLogsPolicy: new PolicyDocument({
            statements: [
              new PolicyStatement({
                actions: [
                  "logs:CreateLogGroup",
                  "logs:CreateLogStream",
                  "logs:DescribeLogGroups",
                  "logs:DescribeLogStreams",
                  "logs:PutLogEvents",
                ],
                resources: [this.cdk.logGroup.logGroupArn],
              }),
            ],
          }),
        },
      });
    }
  }

  private createServer(): void {
    const {
      protocols = ["SFTP"],
      identityProviderType = "SERVICE_MANAGED",
      endpointType = "PUBLIC",
      vpc,
      securityGroups,
      securityPolicyName = "TransferSecurityPolicy-2020-06",
      cdk,
    } = this.props;

    const serverProps: CfnServerProps = {
      protocols,
      identityProviderType,
      endpointType,
      securityPolicyName,
      loggingRole: this.cdk.loggingRole?.roleArn,
      ...(protocols.includes("FTPS") && this.cdk.certificate?.certificateArn
        ? { certificate: this.cdk.certificate.certificateArn }
        : {}),
      ...(cdk?.server &&
      typeof cdk.server === "object" &&
      !("attrArn" in cdk.server)
        ? cdk.server
        : {}),
    };

    // Configure VPC endpoint details
    if (endpointType === "VPC" && vpc) {
      const vpcEndpointDetails: any = {
        vpcId: vpc.vpcId,
        subnetIds: vpc.privateSubnets.map((subnet) => subnet.subnetId),
      };

      if (securityGroups && securityGroups.length > 0) {
        vpcEndpointDetails.securityGroupIds = securityGroups.map(
          (sg) => sg.securityGroupId
        );
      } else {
        // Create default security group
        const defaultSg = new SecurityGroup(this, "SecurityGroup", {
          vpc,
          description: "Security group for Transfer Family server",
          allowAllOutbound: true,
        });

        // Allow SFTP traffic
        defaultSg.addIngressRule(Peer.anyIpv4(), Port.tcp(22), "SFTP access");

        vpcEndpointDetails.securityGroupIds = [defaultSg.securityGroupId];
      }

      serverProps.endpointDetails = vpcEndpointDetails;
    }

    if (cdk?.server && "attrArn" in cdk.server) {
      // Use provided CDK server construct
      this.cdk.server = cdk.server;
    } else {
      // Create new server
      this.cdk.server = new CfnServer(this, "Server", serverProps);
    }
  }

  private setupCustomDomain(): void {
    const { domain } = this.props;

    if (!domain) {
      return;
    }

    const domainData = transferDomain.buildTransferDomainData(
      this,
      domain,
      this.props.protocols || ["SFTP"]
    );
    if (!domainData) {
      return;
    }

    // Store domain-related resources
    if (domainData.certificate) {
      this.cdk.certificate = domainData.certificate as acm.Certificate;
    }

    // Set custom domain URL
    this._customDomainUrl = domainData.url;

    // Create DNS record pointing to the Transfer Family endpoint
    if (domainData.hostedZone) {
      this.cdk.domainRecord = transferDomain.createCNAMERecord(
        this,
        domainData.hostedZone,
        domainData.domainName,
        this.cdk.server.attrEndpoint
      );
    }
  }

  private createUsers(): void {
    const { users = {} } = this.props;

    Object.entries(users).forEach(([username, userProps]) => {
      this.createUser(username, userProps);
    });
  }

  private createUser(username: string, userProps: TransferUserProps): void {
    const {
      role,
      homeDirectory,
      homeDirectoryType = "PATH",
      sshPublicKeys = [],
      posixProfile,
      policy,
      tags = {},
    } = userProps;

    const roleArn = typeof role === "string" ? role : role.roleArn;

    const userCfnProps: CfnUserProps = {
      serverId: this.cdk.server.attrServerId,
      userName: username,
      role: roleArn,
      homeDirectoryType,
      sshPublicKeys,
      tags: Object.entries(tags).map(([key, value]) => ({ key, value })),
    };

    if (homeDirectory) {
      userCfnProps.homeDirectory = homeDirectory;
    }

    if (posixProfile) {
      userCfnProps.posixProfile = {
        uid: posixProfile.uid,
        gid: posixProfile.gid,
        secondaryGids: posixProfile.secondaryGids,
      };
    }

    if (policy) {
      userCfnProps.policy = policy;
    }

    const user = new CfnUser(this, `User-${username}`, userCfnProps);
    this.users[username] = user;
  }
}
