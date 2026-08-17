"""
routers/resources.py
Resources management - allows Admin/Superadmin to upload and manage company documents
with fine-grained access control (all employees, departments, or specific employees).
"""

import os
from datetime import datetime
from typing import List, Optional
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from auth import get_current_user, require_admin
from database import get_db
from models import Resource, ResourceDepartmentAccess, ResourceEmployeeAccess, User, Department
from schemas import ResourceCreate, ResourceOut, ResourceDetailOut
from utils.logger import logger

router = APIRouter()

# Upload directory for resources
UPLOAD_DIR = "backend/uploads/resources"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Allowed file extensions
ALLOWED_EXTENSIONS = {
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    "txt", "csv", "jpg", "jpeg", "png", "gif", "zip"
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def is_file_allowed(filename: str) -> bool:
    """Check if file extension is allowed"""
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_upload_path(filename: str) -> str:
    """Generate unique file path"""
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_")
    safe_name = "".join(c for c in filename if c.isalnum() or c in "._- ")
    unique_filename = timestamp + safe_name
    return os.path.join(UPLOAD_DIR, unique_filename)


def user_has_resource_access(user: User, resource: Resource, db: Session) -> bool:
    """Check if user has access to a resource based on visibility rules"""
    # Admins and superadmins always have access
    if user.role in {"admin", "superadmin"}:
        return True

    # Check visibility type
    if resource.visibility_type == "all_employees":
        return True

    if resource.visibility_type == "departments":
        # Check if user's department matches any allowed department
        dept_access = db.query(ResourceDepartmentAccess).filter(
            ResourceDepartmentAccess.resource_id == resource.id
        ).all()
        dept_ids = {dept.department_id for dept in dept_access}
        
        # Get user's primary department
        user_dept_id = None
        for user_dept in user.departments:
            if user_dept.is_primary:
                user_dept_id = user_dept.department_id
                break
        
        if user_dept_id and user_dept_id in dept_ids:
            return True
        return False

    if resource.visibility_type == "specific_employees":
        # Check if user is in the allowed employees list
        emp_access = db.query(ResourceEmployeeAccess).filter(
            ResourceEmployeeAccess.resource_id == resource.id,
            ResourceEmployeeAccess.employee_id == user.id
        ).first()
        return emp_access is not None

    return False


@router.get("", response_model=List[ResourceOut])
def list_resources(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List resources accessible to the current user.
    - Admins/Superadmins see all resources
    - Employees see only resources they're authorized to access
    """
    if current_user.role in {"admin", "superadmin"}:
        # Admins see all resources
        resources = db.query(Resource).order_by(Resource.created_at.desc()).all()
    else:
        # Employees see only resources they can access
        # All employees resources
        all_emp_resources = db.query(Resource).filter(
            Resource.visibility_type == "all_employees"
        ).all()

        # Department-based resources
        dept_resources = []
        if current_user.departments:
            dept_ids = [d.department_id for d in current_user.departments]
            dept_resources = db.query(Resource).join(
                ResourceDepartmentAccess,
                Resource.id == ResourceDepartmentAccess.resource_id
            ).filter(
                Resource.visibility_type == "departments",
                ResourceDepartmentAccess.department_id.in_(dept_ids)
            ).all()

        # Employee-specific resources
        emp_resources = db.query(Resource).join(
            ResourceEmployeeAccess,
            Resource.id == ResourceEmployeeAccess.resource_id
        ).filter(
            Resource.visibility_type == "specific_employees",
            ResourceEmployeeAccess.employee_id == current_user.id
        ).all()

        # Combine and deduplicate
        resource_ids = set()
        resources = []
        for res in all_emp_resources + dept_resources + emp_resources:
            if res.id not in resource_ids:
                resources.append(res)
                resource_ids.add(res.id)

    return sorted(resources, key=lambda r: r.created_at, reverse=True)


@router.get("/{resource_id}", response_model=ResourceDetailOut)
def get_resource(
    resource_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get resource details (with access check)"""
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    # Check access
    if not user_has_resource_access(current_user, resource, db):
        raise HTTPException(status_code=403, detail="Access denied to this resource")

    # Get access details (only for admin)
    detail = ResourceDetailOut.model_validate(resource)
    if current_user.role in {"admin", "superadmin"}:
        dept_access = db.query(ResourceDepartmentAccess).filter(
            ResourceDepartmentAccess.resource_id == resource_id
        ).all()
        detail.department_ids = [d.department_id for d in dept_access]

        emp_access = db.query(ResourceEmployeeAccess).filter(
            ResourceEmployeeAccess.resource_id == resource_id
        ).all()
        detail.employee_ids = [e.employee_id for e in emp_access]

    return detail


@router.post("", response_model=ResourceDetailOut, status_code=201)
async def create_resource(
    name: str = Form(...),
    description: Optional[str] = Form(None),
    visibility_type: str = Form(...),
    department_ids: Optional[str] = Form(None),  # JSON string
    employee_ids: Optional[str] = Form(None),  # JSON string
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Upload a new resource with visibility settings.
    
    - For visibility_type="all_employees": no department_ids or employee_ids needed
    - For visibility_type="departments": provide department_ids as JSON array
    - For visibility_type="specific_employees": provide employee_ids as JSON array
    """
    # Validate visibility type
    if visibility_type not in {"all_employees", "departments", "specific_employees"}:
        raise HTTPException(status_code=400, detail="Invalid visibility_type")

    # Validate file
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    if not is_file_allowed(file.filename):
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Check file size
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large (max 50MB)")

    # Save file
    file_path = get_upload_path(file.filename)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    
    try:
        with open(file_path, "wb") as f:
            f.write(contents)
    except Exception as e:
        logger.error(f"Error saving file: {e}")
        raise HTTPException(status_code=500, detail="Error saving file")

    # Create resource record
    resource = Resource(
        name=name.strip(),
        description=description.strip() if description else None,
        file_path=file_path,
        file_name=file.filename,
        visibility_type=visibility_type,
        created_by=current_user.id,
    )
    db.add(resource)
    db.flush()  # Get the ID without committing

    # Add access control records
    if visibility_type == "departments" and department_ids:
        import json
        try:
            dept_ids = json.loads(department_ids)
            for dept_id in dept_ids:
                dept = db.query(Department).filter(Department.id == dept_id).first()
                if not dept:
                    db.rollback()
                    raise HTTPException(status_code=400, detail=f"Department {dept_id} not found")
                
                access = ResourceDepartmentAccess(
                    resource_id=resource.id,
                    department_id=dept_id
                )
                db.add(access)
        except json.JSONDecodeError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Invalid department_ids format")

    elif visibility_type == "specific_employees" and employee_ids:
        import json
        try:
            emp_ids = json.loads(employee_ids)
            for emp_id in emp_ids:
                emp = db.query(User).filter(User.id == emp_id, User.role == "user").first()
                if not emp:
                    db.rollback()
                    raise HTTPException(status_code=400, detail=f"Employee {emp_id} not found")
                
                access = ResourceEmployeeAccess(
                    resource_id=resource.id,
                    employee_id=emp_id
                )
                db.add(access)
        except json.JSONDecodeError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Invalid employee_ids format")

    db.commit()
    db.refresh(resource)

    return ResourceDetailOut.model_validate(resource)


@router.put("/{resource_id}", response_model=ResourceDetailOut)
async def update_resource(
    resource_id: int,
    name: str = Form(...),
    description: Optional[str] = Form(None),
    visibility_type: str = Form(...),
    department_ids: Optional[str] = Form(None),
    employee_ids: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update a resource (name, description, visibility)"""
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    # Update basic fields
    resource.name = name.strip()
    resource.description = description.strip() if description else None
    resource.updated_at = datetime.utcnow()

    # Handle visibility change
    if visibility_type != resource.visibility_type:
        # Clear old access records
        db.query(ResourceDepartmentAccess).filter(
            ResourceDepartmentAccess.resource_id == resource_id
        ).delete()
        db.query(ResourceEmployeeAccess).filter(
            ResourceEmployeeAccess.resource_id == resource_id
        ).delete()

        resource.visibility_type = visibility_type

        # Add new access records
        if visibility_type == "departments" and department_ids:
            import json
            try:
                dept_ids = json.loads(department_ids)
                for dept_id in dept_ids:
                    dept = db.query(Department).filter(Department.id == dept_id).first()
                    if not dept:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Department {dept_id} not found")
                    
                    access = ResourceDepartmentAccess(
                        resource_id=resource.id,
                        department_id=dept_id
                    )
                    db.add(access)
            except json.JSONDecodeError:
                db.rollback()
                raise HTTPException(status_code=400, detail="Invalid department_ids format")

        elif visibility_type == "specific_employees" and employee_ids:
            import json
            try:
                emp_ids = json.loads(employee_ids)
                for emp_id in emp_ids:
                    emp = db.query(User).filter(User.id == emp_id, User.role == "user").first()
                    if not emp:
                        db.rollback()
                        raise HTTPException(status_code=400, detail=f"Employee {emp_id} not found")
                    
                    access = ResourceEmployeeAccess(
                        resource_id=resource.id,
                        employee_id=emp_id
                    )
                    db.add(access)
            except json.JSONDecodeError:
                db.rollback()
                raise HTTPException(status_code=400, detail="Invalid employee_ids format")

    # Handle file update
    if file:
        if not is_file_allowed(file.filename):
            raise HTTPException(
                status_code=400,
                detail=f"File type not allowed. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
            )

        contents = await file.read()
        if len(contents) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="File too large (max 50MB)")

        # Delete old file
        if os.path.exists(resource.file_path):
            try:
                os.remove(resource.file_path)
            except Exception as e:
                logger.error(f"Error deleting old file: {e}")

        # Save new file
        file_path = get_upload_path(file.filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        
        try:
            with open(file_path, "wb") as f:
                f.write(contents)
        except Exception as e:
            logger.error(f"Error saving file: {e}")
            raise HTTPException(status_code=500, detail="Error saving file")

        resource.file_path = file_path
        resource.file_name = file.filename

    db.commit()
    db.refresh(resource)

    return ResourceDetailOut.model_validate(resource)


@router.delete("/{resource_id}", status_code=204)
def delete_resource(
    resource_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Delete a resource and its associated file"""
    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    # Delete file
    if os.path.exists(resource.file_path):
        try:
            os.remove(resource.file_path)
        except Exception as e:
            logger.error(f"Error deleting file: {e}")

    # Delete access records and resource
    db.query(ResourceDepartmentAccess).filter(
        ResourceDepartmentAccess.resource_id == resource_id
    ).delete()
    db.query(ResourceEmployeeAccess).filter(
        ResourceEmployeeAccess.resource_id == resource_id
    ).delete()
    db.delete(resource)
    db.commit()

    return None


@router.get("/{resource_id}/download")
def download_resource(
    resource_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download a resource file (with access check)"""
    from fastapi.responses import FileResponse

    resource = db.query(Resource).filter(Resource.id == resource_id).first()
    if not resource:
        raise HTTPException(status_code=404, detail="Resource not found")

    # Check access
    if not user_has_resource_access(current_user, resource, db):
        raise HTTPException(status_code=403, detail="Access denied to this resource")

    # Check file exists
    if not os.path.exists(resource.file_path):
        logger.error(f"Resource file not found: {resource.file_path}")
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=resource.file_path,
        filename=resource.file_name,
        media_type="application/octet-stream"
    )
