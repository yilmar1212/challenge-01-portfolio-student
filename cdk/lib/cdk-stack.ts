import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as fs from 'fs';



export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. Bucket privado
    const bucket = new s3.Bucket(this, 'PortfolioBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. Tabla de metadatos
    const table = new dynamodb.Table(this, 'PortfoliosTable', {
      partitionKey: { name: 'studentId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. CloudFront: público por defecto, firmado en /private/*
    const publicKey = new cloudfront.PublicKey(this, 'SignerPublicKey', {
    encodedKey: fs.readFileSync(path.join(__dirname, '../keys/public_key.pem'), 'utf8'),
    });
    const keyGroup = new cloudfront.KeyGroup(this, 'SignerKeyGroup', {
    items: [publicKey],
    });

const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(bucket);

const distribution = new cloudfront.Distribution(this, 'PortfolioDistribution', {
  defaultRootObject: 'index.html',
  priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
  defaultBehavior: {
    origin: s3Origin,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
  additionalBehaviors: {
    'private/*': {
      origin: s3Origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      trustedKeyGroups: [keyGroup],
    },
  },
});

    // 4. Subir los archivos de application/ al bucket
    new s3deploy.BucketDeployment(this, 'DeployPortfolio', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../application'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // 5. Roles IAM de mínimo privilegio
    const writerRole = new iam.Role(this, 'PortfolioWriterRole', {
      assumedBy: new iam.AccountRootPrincipal(),
      description: 'Puede escribir archivos en el bucket del portafolio',
    });
    bucket.grantWrite(writerRole);

    const readerRole = new iam.Role(this, 'PortfolioReaderRole', {
      assumedBy: new iam.AccountRootPrincipal(),
      description: 'Solo puede leer la tabla de metadatos',
    });
    table.grantReadData(readerRole);

    // 6. Ítem de prueba en DynamoDB
    new cr.AwsCustomResource(this, 'SeedPortfolioItem', {
      onCreate: {
        service: 'DynamoDB',
        action: 'putItem',
        parameters: {
          TableName: table.tableName,
          Item: {
            studentId: { S: 'univalle-2026-001' },
            studentName: { S: 'Ana Estudiante' },
            program: { S: 'Ingeniería de Sistemas' },
            publishedAt: { S: '2026-09-19T10:00:00Z' },
            url: { S: `https://${distribution.distributionDomainName}/index.html` },
            visibility: { S: 'public' },
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of('seed-univalle-2026-001'),
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: [table.tableArn],
      }),
    });

    // Dominio de CloudFront al terminar el deploy
    new cdk.CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
    });
    new cdk.CfnOutput(this, 'KeyPairId', {
      value: publicKey.publicKeyId,
    });
  }
}