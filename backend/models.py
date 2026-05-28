from sqlalchemy import Column, Integer, String, DateTime, Date, Boolean, ForeignKey
from sqlalchemy.sql import func
from database import Base


class SavedFood(Base):
    __tablename__ = "saved_foods"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    default_image_path = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class FridgeItem(Base):
    __tablename__ = "fridge_items"

    id = Column(Integer, primary_key=True, index=True)
    saved_food_id = Column(Integer, ForeignKey("saved_foods.id"), nullable=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    date_added = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    image_path = Column(String, nullable=True)
    active = Column(Boolean, default=True)
    quantity = Column(Integer, default=1, nullable=False, server_default="1")
    expiration_date = Column(Date, nullable=True)
