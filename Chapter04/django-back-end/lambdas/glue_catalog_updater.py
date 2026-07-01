"""glue_catalog_updater.py — Generic Glue Catalog table create/update helper.

Can be called as a Lambda or imported by other lambdas.
"""
import json, os
import boto3

REGION  = os.getenv("AWS_REGION",  "us-east-1")
GLUE_DB = os.getenv("GLUE_DATABASE", "fhir-table-db")
BUCKET  = os.getenv("STAGING_BUCKET", "dgs-glue-staging")


def _glue():
    return boto3.client("glue", region_name=REGION)


def register_table(database: str, table_name: str, s3_prefix: str, columns: list) -> dict:
    """Create or update a Glue table definition.

    Args:
        database:   Glue database name
        table_name: Glue table name
        s3_prefix:  Full S3 URI prefix, e.g. 's3://bucket/prefix/'
        columns:    List of {"Name": ..., "Type": "string"} dicts

    Returns:
        {"action": "created"|"updated", "table": table_name, "database": database}
    """
    glue = _glue()
    sd = {
        "Location":     s3_prefix,
        "InputFormat":  "org.apache.hadoop.mapred.TextInputFormat",
        "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
        "SerdeInfo": {
            "SerializationLibrary": "org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe",
            "Parameters": {"field.delim": ",", "skip.header.line.count": "1"},
        },
        "Columns": columns,
    }
    table_input = {"Name": table_name, "StorageDescriptor": sd, "TableType": "EXTERNAL_TABLE"}
    try:
        glue.get_table(DatabaseName=database, Name=table_name)
        glue.update_table(DatabaseName=database, TableInput=table_input)
        action = "updated"
    except glue.exceptions.EntityNotFoundException:
        try:
            glue.get_database(Name=database)
        except glue.exceptions.EntityNotFoundException:
            glue.create_database(DatabaseInput={"Name": database})
        glue.create_table(DatabaseName=database, TableInput=table_input)
        action = "created"
    return {"action": action, "table": table_name, "database": database}


def lambda_handler(event, context):
    """Lambda entry point.

    event = {
        "table_name": str,
        "s3_prefix":  str,     # full s3://... URI prefix
        "columns":    [{"Name": ..., "Type": ...}],
        "database":   str      # optional, defaults to GLUE_DB env var
    }
    """
    database   = event.get("database", GLUE_DB)
    table_name = event["table_name"]
    s3_prefix  = event["s3_prefix"]
    columns    = event.get("columns", [])
    result = register_table(database, table_name, s3_prefix, columns)
    return {"statusCode": 200, "body": json.dumps(result)}
