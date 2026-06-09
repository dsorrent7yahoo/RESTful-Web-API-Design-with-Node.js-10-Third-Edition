
import csv
import boto3

# Initialize the DynamoDB client
dynamodb = boto3.resource('dynamodb', region_name='us-east-1') # Change to your region
table = dynamodb.Table('patients')

# Open your local CSV file
with open('patients.csv', mode='r', encoding='utf-8') as csv_file:
    reader = csv.DictReader(csv_file)
    
    # Loop through rows and upload to DynamoDB
    for row in reader:
        # Remove keys with empty string values (DynamoDB does not allow empty strings)
        clean_row = {k: v for k, v in row.items() if v != ''}
        table.put_item(Item=clean_row)

print("Upload complete!")