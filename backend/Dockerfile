# Step 1: Base image - Python 3.12
FROM python:3.12

# Step 2: Set working directory inside container
WORKDIR /app

# Step 3: Copy requirements file first (for better caching)
COPY requirements.txt .

# Step 4: Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Step 5: Copy the rest of the application code
COPY . .

# Step 6: Create uploads folder
RUN mkdir -p uploads

# Step 7: Expose port 8000
EXPOSE 8000

# Step 8: Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]